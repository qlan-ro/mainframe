// Mainframe demo — first session, and the agent asking back.
//
// Adapted from the v1 feature-recorder take of 2026-05-09 ("create first Claude
// session in mainframe-web, hover adapter popover, send a tool-use prompt, answer
// the permission card with a custom answer"), recovered from iCloud. Same beats,
// current UI: the old selectors (data-mf-composer-input, data-tutorial,
// data-new-session-popover) all belonged to the Electron renderer. The prompt text
// is rewritten to match the question the mock adapter replays, so the exchange reads
// as a conversation rather than a non-sequitur.
//
// Boot first:  MF_DEMO_RECORDING_KEY=ask-question .agents/demo-env.sh up
// Record:      playwright-cli -s=demo run-code --filename=demos/first-session.demo.js
async page => {
  const APP_URL = 'http://localhost:5183';
  const OUT = '/tmp/mainframe-demo/out/first-session.webm';
  const SIZE = { width: 1280, height: 800 };
  const TOUR_OFF = '{"state":{"completed":true,"step":4},"version":0}';
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
  await page.addInitScript((v) => localStorage.setItem('mf:tutorial', v), TOUR_OFF);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);

  // A take that throws leaves the screencast running, and every later run then
  // fails with "Screencast is already started" — masking the real error.
  await page.screencast.stop().catch(() => {});
  await page.screencast.start({ path: OUT, size: SIZE });

  // ---- Beat 1: a project, no sessions -------------------------------------
  await page.screencast.showChapter('Your first session', {
    description: 'Pick a project and start talking to it.',
    duration: 2000,
  });

  const project = page.getByRole('button', { name: /acme-web/ }).first();
  await project.click();
  await page.waitForTimeout(800);
  await page.getByTestId('sessions-new-button').click();
  const composer = page.getByTestId('chat-composer-input');
  await composer.waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);

  // ---- Beat 2: the session is configurable before it exists ---------------
  // The v1 take opened the adapter popover here, back when the adapter was chosen
  // at creation. Its descendant is the composer's model control.
  const modelButton = page.getByRole('button', { name: /Provider and model/ });
  const modelMark = await page.screencast.showOverlay(
    label(await modelButton.boundingBox(), 'Model and permissions, before the first word'),
  );
  await page.waitForTimeout(1800);
  await modelMark.dispose();
  await page.waitForTimeout(400);

  // ---- Beat 3: ask ---------------------------------------------------------
  await page.screencast.showChapter('Asking for work', { duration: 1800 });

  await composer.click();
  await composer.pressSequentially(PROMPT, { delay: 55 });
  await page.waitForTimeout(700);
  await composer.press('Enter');

  // ~1 send in 2 is dropped client-side ("workflow abandoned for __LOCALID_…"),
  // so resend once rather than record a dead take.
  const sent = await page
    .getByText(PROMPT, { exact: true })
    .waitFor({ timeout: 4000 })
    .then(() => true, () => false);
  if (!sent) {
    await composer.click();
    await composer.pressSequentially(PROMPT, { delay: 55 });
    await page.waitForTimeout(400);
    await composer.press('Enter');
  }

  // ---- Beat 4: the agent asks back ----------------------------------------
  const gate = page.getByTestId('chat-question-gate');
  await gate.waitFor({ timeout: 30000 });
  await page.waitForTimeout(900);

  await page.screencast.showChapter('It asks before it guesses', {
    description: 'Answer inline and it picks up from there.',
    duration: 2200,
  });

  // v1 filmed the custom-answer path ("Other…" + a typed reply) against a real
  // adapter. Under mock replay the transcript is fixed — the answered card always
  // renders the recorded selection — so choosing anything else puts a lie on screen.
  // Film that beat with MF_E2E_ALLOW_REAL_ADAPTER, or record a new fixture.
  const choice = page.getByTestId('chat-question-option-0-Work on index.ts');
  const choiceMark = await page.screencast.showOverlay(
    label(await choice.boundingBox(), 'Answer without leaving the thread'),
  );
  await page.waitForTimeout(1400);
  await choice.click();
  await choiceMark.dispose();
  await page.waitForTimeout(700);
  await page.getByTestId('chat-question-submit').click();

  // ---- Beat 5: it picks up where you pointed it ---------------------------
  await page.waitForTimeout(2500);
  await page.mouse.move(950, 520);
  await page.waitForTimeout(1600);

  await page.screencast.stop();
  return OUT;
}
