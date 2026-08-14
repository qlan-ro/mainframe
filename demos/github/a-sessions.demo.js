// GitHub tour, segment A — projects, sessions, and a working agent.
// Boot: MF_DEMO_RECORDING_KEY=tool-group .agents/demo-env.sh up
//
// Returns a TIMELINE as JSON: every action's normalized position and the ms it
// happened at, relative to the first recorded frame. `to-recordly.mjs` turns that
// into a Recordly cursor track and zoom regions — the coordinates are exact, so
// nothing downstream has to infer where a click landed.
async page => {
  const APP_URL = 'http://localhost:5183';
  const OUT = '/tmp/mainframe-demo/out/tour-a.webm';
  // 1920 wide: the transcript is a fixed-width centred column, so the floating
  // session panels only clear it once there is real margin to the right.
  const SIZE = { width: 1920, height: 1080 };

  // Chapter cards are off for the shipped cut. Flip CHAPTERS to true to get the
  // full-screen title cards back; the pause keeps the pacing either way.
  const CHAPTERS = false;
  const chapter = (title, opts) =>
    CHAPTERS ? page.screencast.showChapter(title, opts) : page.waitForTimeout(700);

  const PROMPT = 'Where is greeting defined?';

  const label = (b, text) => `
    <div style="position:absolute; top:${b.y - 3}px; left:${b.x - 3}px;
      width:${b.width + 6}px; height:${b.height + 6}px;
      border:2px solid #3b82f6; border-radius:8px;"></div>
    <div style="position:absolute; top:${b.y + b.height + 10}px;
      left:${b.x + b.width / 2}px; transform:translateX(-50%);
      padding:6px 12px; background:rgba(0,0,0,.75); border-radius:8px;
      font:13px -apple-system,system-ui; color:#fff; white-space:nowrap;">${text}</div>`;

  let t0 = 0;
  const marks = [];
  const mark = async (locator, kind, cursorType, note) => {
    const b = await locator.boundingBox();
    if (!b) return;
    marks.push({
      tMs: Date.now() - t0,
      kind,
      cursorType,
      note,
      cx: (b.x + b.width / 2) / SIZE.width,
      cy: (b.y + b.height / 2) / SIZE.height,
      w: b.width / SIZE.width,
      h: b.height / SIZE.height,
    });
  };

  await page.setViewportSize(SIZE);
  await page.addInitScript((v) => localStorage.setItem('mf:tutorial', v), '{"state":{"completed":true,"step":4},"version":0}');
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);

  await page.screencast.stop().catch(() => {});
  await page.screencast.start({ path: OUT, size: SIZE });
  t0 = Date.now();

  await chapter('Every project, every session', {
    description: 'One list, grouped by when you last touched it.',
    duration: 2000,
  });
  const project = page.getByRole('button', { name: /acme-web/ }).first();
  await mark(project, 'click', 'pointer', 'filter to the project');
  await project.click();
  await page.waitForTimeout(1100);

  await chapter('Ask, and watch it work', { duration: 1800 });
  const newSession = page.getByTestId('sessions-new-button');
  await mark(newSession, 'click', 'pointer', 'new session');
  await newSession.click();
  const composer = page.getByTestId('chat-composer-input');
  await composer.waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  await mark(composer, 'click', 'text', 'composer');
  await composer.click();
  await composer.pressSequentially(PROMPT, { delay: 55 });
  await page.waitForTimeout(600);
  await composer.press('Enter');
  const sent = await page.getByText(PROMPT, { exact: true }).waitFor({ timeout: 4000 }).then(() => true, () => false);
  // The dropped-send race (see demos/README) must never be filmed: a retype on
  // camera reads as a bug. Fail the take and let the harness re-run it clean.
  if (!sent) throw new Error('dropped send — retake');

  // Wait for the FINAL line, not the opening one: the reply is still streaming when
  // "I'll search for that." lands, and the take used to end on a "Thinking…" frame.
  await page.getByText("I'll search for that.").waitFor({ timeout: 30000 });
  await page.getByText(/Found it:/).waitFor({ timeout: 30000 });
  await page.waitForTimeout(900);
  const toolGroup = page.getByRole('button', { name: /Read 1 file/ }).first();
  await toolGroup.waitFor({ timeout: 15000 });
  await mark(toolGroup, 'dwell', 'arrow', 'tool group lands');
  const callout = await page.screencast.showOverlay(label(await toolGroup.boundingBox(), 'Every tool call, grouped and inspectable'));
  await page.waitForTimeout(2200);
  await callout.dispose();
  await page.mouse.move(950, 540);
  await page.waitForTimeout(1200);

  await page.screencast.stop();
  return JSON.stringify({ video: OUT, size: SIZE, durationMs: Date.now() - t0, marks });
}
