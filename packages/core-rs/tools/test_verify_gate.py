import tempfile
import unittest
from pathlib import Path

from verify_gate import scan_file


class GateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / 'Cargo.toml').write_text('[package]\nname="fixture"\n')

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def test_explicit_test_module_and_its_descendant(self):
        self.write('src/lib.rs', '#[cfg(test)]\n#[path="support.rs"] mod checks;')
        parent = self.write('src/support.rs', 'mod child; fn check() { x.unwrap(); }')
        child = self.write('src/support/child.rs', 'fn check() { x.expect("test"); }')
        self.assertEqual(scan_file(parent), [])
        self.assertEqual(scan_file(child), [])

    def test_include_inside_inline_test_module(self):
        self.write('src/lib.rs', '#[cfg(test)] mod checks { include!("cases.rs"); }')
        path = self.write('src/cases.rs', 'fn check() { panic!("test"); }')
        self.assertEqual(scan_file(path), [])

    def test_fake_test_attribute_cannot_exempt_production_module(self):
        for fake in ['// #[cfg(test)] mod live;', 'const S: &str = "#[cfg(test)] mod live;";']:
            with self.subTest(fake=fake):
                self.write('src/lib.rs', fake + '\nmod live;')
                path = self.write('src/live.rs', 'fn run() { x.unwrap(); }')
                self.assertEqual(len(scan_file(path)), 1)

    def test_production_reference_prevents_shared_file_exemption(self):
        for declaration in ['#[path="shared.rs"] mod live;', 'include!("shared.rs");']:
            with self.subTest(declaration=declaration):
                self.write('src/lib.rs', '#[cfg(test)] mod checks { include!("shared.rs"); }\n' + declaration)
                path = self.write('src/shared.rs', 'fn run() { x.unwrap(); }')
                self.assertEqual(len(scan_file(path)), 1)

    def test_external_test_declaration_does_not_exempt_next_function(self):
        path = self.write('src/lib.rs', '#[cfg(test)] mod checks;\nfn run() { x.unwrap(); }')
        self.write('src/checks.rs', 'fn check() { x.unwrap(); }')
        self.assertEqual(len(scan_file(path)), 1)

    def test_inline_test_block_does_not_exempt_same_line_production(self):
        path = self.write('src/lib.rs', '#[cfg(test)] mod checks { fn t() { x.unwrap(); } } fn run() { x.unwrap(); }')
        self.assertEqual(len(scan_file(path)), 1)

    def test_raw_literals_and_comments_cannot_declare_test_sources(self):
        self.write('src/lib.rs', 'const S: &str = r##"#[cfg(test)] mod checks { include!("live.rs"); }"##;\n'
                   '/* #[cfg(test)] #[path="live.rs"] mod checks; */\nmod live;')
        path = self.write('src/live.rs', 'fn run() { x.unwrap(); }')
        self.assertEqual(len(scan_file(path)), 1)

    def test_attribute_order_and_raw_path_are_supported(self):
        self.write('src/lib.rs', '#[path=r#"support.rs"#]\n#[cfg(test)] pub(crate) mod checks;')
        path = self.write('src/support.rs', 'fn check() { x.unwrap(); }')
        self.assertEqual(scan_file(path), [])

    def test_nested_default_modules_and_include_chain_inherit_test_scope(self):
        self.write('src/lib.rs', '#[cfg(test)] mod checks;')
        self.write('src/checks/mod.rs', 'mod nested;')
        self.write('src/checks/nested.rs', 'include!("cases.rs");')
        path = self.write('src/checks/cases.rs', 'fn check() { x.unwrap(); }')
        self.assertEqual(scan_file(path), [])

    def test_production_tests_directory_and_undeclared_sibling_are_not_exempt(self):
        self.write('src/lib.rs', '#[cfg(test)] mod checks; mod tests;')
        self.write('src/checks/mod.rs', '')
        for name in ['src/tests.rs', 'src/checks/orphan.rs']:
            path = self.write(name, 'fn run() { x.unwrap(); }')
            self.assertEqual(len(scan_file(path)), 1)

    def test_braces_in_literals_do_not_end_inline_test_scope(self):
        path = self.write('src/lib.rs', '#[cfg(test)] mod checks {\n'
                          'fn test() { let s = "}"; let c = \'}\'; x.unwrap(); }\n' +
                          '}\nfn run() { x.unwrap(); }')
        self.assertEqual(len(scan_file(path)), 1)

    def test_unsafe_and_other_always_forbidden_patterns_stay_forbidden(self):
        self.write('src/lib.rs', '#[cfg(test)] #[path="support.rs"] mod checks;')
        path = self.write('src/support.rs', 'fn check() { unsafe { x(); } todo!(); x.unwrap(); }')
        violations = scan_file(path)
        self.assertEqual(len(violations), 2)
        self.assertTrue(any('`unsafe`' in message for message in violations))
        self.assertTrue(any('`todo!(`' in message for message in violations))

    def test_integration_test_exemption_keeps_unsafe_forbidden(self):
        path = self.write('tests/integration.rs', 'fn check() { x.unwrap(); unsafe { x(); } }')
        violations = scan_file(path)
        self.assertEqual(len(violations), 1)
        self.assertIn('`unsafe`', violations[0])

    def test_test_include_cannot_exempt_the_production_crate_root(self):
        path = self.write('src/lib.rs', '#[cfg(test)] mod checks { include!("lib.rs"); }\n'
                          'fn run() { x.unwrap(); }')
        self.assertEqual(len(scan_file(path)), 1)


if __name__ == '__main__':
    unittest.main()
