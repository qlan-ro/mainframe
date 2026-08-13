// Mainframe demo — start a session and ask a question.
// Boot first:  .agents/demo-env.sh up
// Record:      playwright-cli -s=demo run-code --filename=demos/session-tour.demo.js
async page => {
  const APP_URL = 'http://localhost:5183';
  const OUT = '/tmp/mainframe-demo/out/session-tour.webm';
  const SIZE = { width: 1280, height: 800 };
  const TOUR_OFF = '{"state":{"completed":true,"step":4},"version":0}';

  const label = (b, text, place = 'below') => `
    <div style="position:absolute; top:${b.y - 3}px; left:${b.x - 3}px;
      width:${b.width + 6}px; height:${b.height + 6}px;
      border:2px solid #3b82f6; border-radius:8px;"></div>
    <div style="position:absolute;
      top:${place === 'below' ? b.y + b.height + 10 : b.y - 40}px;
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

  // ---- Beat 1: the workspace ------------------------------------------------
  await page.screencast.showChapter('A project in Mainframe', {
    description: 'One workspace, no sessions yet.',
    duration: 2000,
  });

  const project = page.getByRole('button', { name: /acme-web/ }).first();
  const marker = await page.screencast.showOverlay(label(await project.boundingBox(), 'Filter to one project'));
  await page.waitForTimeout(1200);
  await project.click();
  await marker.dispose();
  await page.waitForTimeout(900);

  // ---- Beat 2: start a session ---------------------------------------------
  await page.screencast.showChapter('Starting a session', { duration: 1800 });

  const newSession = page.getByTestId('sessions-new-button');
  await newSession.click();
  const composer = page.getByTestId('chat-composer-input');
  await composer.waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);

  // ---- Beat 3: ask ----------------------------------------------------------
  await page.screencast.showChapter('Asking a question', {
    description: 'The agent reads the repo before it answers.',
    duration: 2000,
  });

  const PROMPT = 'Where is greeting defined?';
  await composer.click();
  await composer.pressSequentially(PROMPT, { delay: 60 });
  await page.waitForTimeout(700);
  await composer.press('Enter');

  // Roughly one send in two is dropped client-side: the new-thread coordinator logs
  // "workflow abandoned for __LOCALID_…", archives the chat it just created, and the
  // message never reaches the daemon. Retype and resend once rather than record a
  // dead take — the second send commits the same slot.
  const sent = await page
    .getByText(PROMPT, { exact: true })
    .waitFor({ timeout: 4000 })
    .then(() => true, () => false);
  if (!sent) {
    await composer.click();
    await composer.pressSequentially(PROMPT, { delay: 60 });
    await page.waitForTimeout(400);
    await composer.press('Enter');
  }

  // ---- Beat 4: the answer ---------------------------------------------------
  await page.getByText("I'll search for that.").waitFor({ timeout: 30000 });
  await page.waitForTimeout(900);

  const toolGroup = page.getByRole('button', { name: /Read 1 file/ }).first();
  await toolGroup.waitFor({ timeout: 15000 });
  const callout = await page.screencast.showOverlay(
    label(await toolGroup.boundingBox(), 'Every tool call, grouped and inspectable'),
  );
  await page.waitForTimeout(2400);
  await callout.dispose();

  // Park the cursor over empty transcript space. Anywhere near the composer toolbar
  // and its tooltip ("Permission: Interactive") sits open through the whole held frame.
  await page.mouse.move(900, 520);
  await page.waitForTimeout(1600);

  await page.screencast.stop();
  return OUT;
}
