import tempfile
import unittest
from pathlib import Path

from arch_tiers import START, END, check_document, render
from verify_gate_ratchet import compare_limits
from verify_gate_rules import check_retired_sources, check_lengths, scan_conventions


class ConventionTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def scan(self, text, name='src/example.rs', test=False, allowed=frozenset()):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return scan_conventions(path, {path.resolve()} if test else set(), allowed)

    def test_public_result_string(self):
        self.assertEqual(len(self.scan('pub async fn read() -> Result<Vec<(u8, u8)>, String> {}')), 1)
        self.assertEqual(self.scan('pub fn read() -> Result<HashMap<String, String>, Error> {}'), [])
        self.assertEqual(self.scan('fn read() -> Result<(), String> {}'), [])

    def test_discarded_call(self):
        self.assertEqual(len(self.scan('fn run() { let _ = persist().await; }')), 1)
        for expression in ['let _ = sender.send(value);', 'let _ = sender.try_send(value);',
                           'let _ = persist(); /* expected */',
                           'let _ = persist();\ntracing::warn!("failed");']:
            self.assertEqual(self.scan(expression), [])
        self.assertEqual(len(self.scan('let _ = persist(); // warn!("not real")')), 1)

    def test_printing(self):
        self.assertEqual(len(self.scan('eprintln!("failure");')), 1)
        self.assertEqual(self.scan('println!("version");', 'mainframe-daemon/src/cli/version.rs'), [])
        self.assertEqual(len(self.scan('println!("version");', 'mainframe-daemon/src/main.rs')), 2)
        self.assertEqual(self.scan('println!("test");', test=True), [])

    def test_retired_references_even_in_comments(self):
        self.assertEqual(len(self.scan('// PORT' + ' STATUS\n// packages/core' + '/old.ts')), 2)

    def test_tracing_fields_only_in_macros(self):
        self.assertEqual(len(self.scan('tracing::warn!(\n target: "legacy", error = %e, "message");')), 1)
        self.assertEqual(len(self.scan('debug!(module = "legacy", "message");')), 1)
        self.assertEqual(self.scan('let module = 1; info!("module = text, target: text");'), [])

    def test_forbid_required_on_roots(self):
        self.assertEqual(len(self.scan('// #![forbid(unsafe_code)]', 'src/lib.rs')), 1)
        self.assertEqual(self.scan('#![forbid(unsafe_code)]', 'src/lib.rs'), [])

    def test_sleep_only_in_tests(self):
        self.assertEqual(len(self.scan('tokio::time::sleep(interval).await;', test=True)), 1)
        self.assertEqual(self.scan('tokio::time::sleep(interval).await;'), [])
        self.assertEqual(self.scan('sleep(interval);', test=True, allowed={'src/example.rs'}), [])
        self.assertEqual(len(self.scan('#[cfg(test)] mod cases { fn run() { sleep(interval); } }')), 1)
        self.assertEqual(self.scan('fn asleep() {} // sleep(interval)'), [])

    def test_production_allow(self):
        self.assertEqual(len(self.scan('#[allow(dead_code)] fn example() {}')), 1)
        self.assertEqual(self.scan('#[allow(dead_code)] fn example() {}', test=True), [])
        self.assertEqual(self.scan('#[expect(dead_code, reason = "fixture")] fn example() {}'), [])
        self.assertEqual(self.scan('#[cfg(test)] #[allow(dead_code)] mod cases {}'), [])

    def test_length_ratchet(self):
        path = self.root / 'src/example.rs'
        path.parent.mkdir(parents=True)
        path.write_text('fn example() {}\n' * 301)
        self.assertEqual(len(check_lengths(self.root, {}, set())), 1)
        self.assertEqual(check_lengths(self.root, {'src/example.rs': 301}, set()), [])
        path.write_text('fn example() {}\n' * 302)
        self.assertEqual(len(check_lengths(self.root, {'src/example.rs': 301}, set())), 1)

    def test_length_excludes_inline_tests_but_counts_test_files(self):
        path = self.root / 'src/example.rs'
        path.parent.mkdir(parents=True)
        path.write_text('#[cfg(test)] mod cases {\n' + 'fn example() {}\n' * 301 + '}\n')
        self.assertEqual(check_lengths(self.root, {}, set()), [])
        self.assertEqual(len(check_lengths(self.root, {}, {path.resolve()})), 1)

    def test_generated_tiers(self):
        for name, deps in [('a', ''), ('b', '[dependencies]\na = { path = "../a" }')]:
            path = self.root / name / 'Cargo.toml'
            path.parent.mkdir()
            path.write_text(f'[package]\nname = "{name}"\n{deps}\n')
        expected = '| Tier | Crate | Internal dependencies |\n|---|---|---|\n| 0 | `a` | — |\n| 1 | `b` | `a` |'
        self.assertEqual(render(self.root), expected)
        doc = self.root / 'ARCHITECTURE.md'
        doc.write_text(f'{START}\n{expected}\n{END}\n')
        self.assertEqual(check_document(self.root, doc), [])
        doc.write_text(f'{START}\nstale\n{END}\n')
        self.assertEqual(len(check_document(self.root, doc)), 1)

    def test_ratchet_cannot_add_or_grow_exceptions(self):
        self.assertEqual(compare_limits({'a.rs': 310}, {'a.rs': 320}), [])
        self.assertEqual(compare_limits({}, {'a.rs': 320}), [])
        self.assertEqual(len(compare_limits({'a.rs': 321}, {'a.rs': 320})), 1)
        self.assertEqual(len(compare_limits({'b.rs': 301}, {'a.rs': 320})), 1)

    def test_public_trait_result_string(self):
        self.assertEqual(len(self.scan("pub trait Port { fn read(&self) -> Result<(), String>; }")), 1)
        self.assertEqual(self.scan("trait Internal { fn read(&self) -> Result<(), String>; }"), [])

    def test_test_support_feature_is_test_code(self):
        self.assertEqual(self.scan('#[cfg(any(test, feature = "test-support"))] #[allow(dead_code)] mod fixture {}'), [])

    def test_retired_reference_in_non_rust_source(self):
        (self.root / 'fixture.json').write_text('"packages/core' + '/old.ts"')
        (self.root / 'target').mkdir()
        (self.root / 'target' / 'generated.txt').write_text('PORT' + ' STATUS')
        self.assertEqual(len(check_retired_sources(self.root)), 1)

    def test_tracing_span_and_brace_macros(self):
        self.assertEqual(len(self.scan('tracing::debug_span!("job", module = "legacy");')), 1)
        self.assertEqual(len(self.scan('tracing::event! { target: "legacy", Level::INFO, "message" }')), 1)

    def test_manifest_alias_and_target_dependency_ignore_dev_edges(self):
        for name, deps in [
            ('a', '[dev-dependencies]\nb = { path = "../b" }'),
            ('b', "[target.'cfg(unix)'.dependencies]\nalias = { package = \"a\", path = \"../a\" }"),
        ]:
            path = self.root / name / 'Cargo.toml'
            path.parent.mkdir()
            path.write_text(f'[package]\nname = "{name}"\n{deps}\n')
        self.assertIn('| 1 | `b` | `a` |', render(self.root))
