// GitHub tour, segment B — the agent asks instead of guessing.
// Boot: MF_DEMO_RECORDING_KEY=ask-question .agents/demo-env.sh up
async page => {
  const APP_URL = 'http://localhost:5183';
  const OUT = '/tmp/mainframe-demo/out/tour-b.webm';
  // 1920 wide: the transcript is a fixed-width centred column, so the floating
  // session panels only clear it once there is real margin to the right.
  const SIZE = { width: 1920, height: 1080 };

  let t0 = 0;
  const marks = [];
  const mark = async (locator, kind, cursorType, note) => {
    const b = await locator.boundingBox().catch(() => null);
    if (!b) return;
    marks.push({ tMs: Date.now() - t0, kind, cursorType, note,
      cx: (b.x + b.width / 2) / SIZE.width, cy: (b.y + b.height / 2) / SIZE.height,
      w: b.width / SIZE.width, h: b.height / SIZE.height });
  };
  const tap = async (locator, cursorType, note, opts) => {
    await mark(locator, 'click', cursorType, note);
    await locator.click(opts ?? {});
  };

  // Chapter cards are off for the shipped cut. Flip CHAPTERS to true to get the
  // full-screen title cards back; the pause keeps the pacing either way.
  const CHAPTERS = false;
  const chapter = (title, opts) =>
    CHAPTERS ? page.screencast.showChapter(title, opts) : page.waitForTimeout(700);

  const PROMPT = 'Set up this project for me — where should we start?';

  const label = (b, text) => `
    <div style="position:absolute; top:${b.y - 3}px; left:${b.x - 3}px;
      width:${b.width + 6}px; height:${b.height + 6}px;
      border:2px solid #3b82f6; border-radius:8px;"></div>
    <div style="position:absolute; top:${b.y + b.height + 10}px;
      left:${b.x + b.width / 2}px; transform:translateX(-50%);
      padding:6px 12px; background:rgba(0,0,0,.75); border-radius:8px;
      font:13px -apple-system,system-ui; color:#fff; white-space:nowrap;">${text}</div>`;

  await page.setViewportSize(SIZE);
  await page.addInitScript((v) => localStorage.setItem('mf:tutorial', v), '{"state":{"completed":true,"step":4},"version":0}');
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /acme-web/ }).first().click();
  await page.waitForTimeout(600);
  await page.getByTestId('sessions-new-button').click();
  const composer = page.getByTestId('chat-composer-input');
  await composer.waitFor({ timeout: 15000 });
  await page.waitForTimeout(900);

  // A take that throws leaves the screencast running, and every later run then
  // fails with "Screencast is already started" — masking the real error.
  await page.screencast.stop().catch(() => {});
  await page.screencast.start({ path: OUT, size: SIZE });
  t0 = Date.now();
  await chapter('It asks before it guesses', {
    description: 'Questions arrive inline, and are answered inline.',
    duration: 2000,
  });

  await tap(composer, 'text', 'composer');
  await composer.pressSequentially(PROMPT, { delay: 50 });
  await page.waitForTimeout(500);
  await composer.press('Enter');
  const sent = await page.getByText(PROMPT, { exact: true }).waitFor({ timeout: 4000 }).then(() => true, () => false);
  // The dropped-send race (see demos/README) must never be filmed: a retype on
  // camera reads as a bug. Fail the take and let the harness re-run it clean.
  if (!sent) throw new Error('dropped send — retake');

  await page.getByTestId('chat-question-gate').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  const choice = page.getByTestId('chat-question-option-0-Work on index.ts');
  const choiceMark = await page.screencast.showOverlay(label(await choice.boundingBox(), 'Answer without leaving the thread'));
  await page.waitForTimeout(1500);
  await tap(choice, 'pointer', 'answer inline');
  await choiceMark.dispose();
  await page.waitForTimeout(600);
  await tap(page.getByTestId('chat-question-submit'), 'pointer', 'submit');
  await page.waitForTimeout(2600);
  await page.mouse.move(950, 560);
  await page.waitForTimeout(1200);

  await page.screencast.stop();
  return JSON.stringify({ video: OUT, size: SIZE, durationMs: Date.now() - t0, marks });
}
