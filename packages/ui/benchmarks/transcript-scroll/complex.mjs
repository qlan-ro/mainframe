async function expand(toggle) {
  await toggle.evaluate((el) => {
    el.addEventListener(
      'pointerdown',
      () => {
        window.toggleTop = el.getBoundingClientRect().top;
      },
      { once: true },
    );
  });
  await toggle.click();
  await toggle.page().waitForTimeout(300);
  return toggle.evaluate((el) => el.getBoundingClientRect().top - window.toggleTop);
}

async function scrollOutput(page, output) {
  const parentTop = await page.locator('#viewport').evaluate((el) => el.scrollTop);
  const accepted = await output.evaluate((el) => {
    for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.id === 'viewport') throw new Error('Missing nested output scroller');
      if (getComputedStyle(ancestor).overflowY === 'auto' && ancestor.scrollHeight > ancestor.clientHeight + 100) {
        ancestor.scrollTop = 0;
        ancestor.scrollTop = 100;
        return ancestor.scrollTop;
      }
    }
    throw new Error('Missing scrollable output');
  });
  await page.waitForTimeout(300);
  return {
    nestedScrollErrorPx: accepted - 100,
    parentScrollJumpPx: await page.locator('#viewport').evaluate((el, top) => el.scrollTop - top, parentTop),
  };
}

export async function measureComplex(page) {
  const toolAnchorShiftPx = await expand(page.getByRole('button', { name: 'Read files', exact: true }).first());
  const detailAnchorShiftPx = await expand(page.getByRole('button', { name: 'Read /src/long-0.ts', exact: true }));
  const outputScroll = await scrollOutput(page, page.getByTestId('read-card-code-preview').first());
  const agent = page.getByRole('button', { name: /explorer/ }).first();
  const agentAnchorShiftPx = await expand(agent);
  const nested = page.getByTestId((await agent.getAttribute('data-testid')).replace('toggle', 'details'));
  await page.getByText('Nested transcript content.', { exact: false }).first().waitFor();
  const nestedGroupShiftPx = await expand(nested.getByRole('button', { name: 'Read files', exact: true }));
  const nestedDetailShiftPx = await expand(
    nested.getByRole('button', { name: 'Read /src/long-child-0.ts', exact: true }),
  );
  const nestedScroll = await scrollOutput(page, page.getByTestId('read-card-code-preview').last());
  await page.screenshot({
    path: `${process.env.BENCHMARK_ARTIFACT_DIR ?? '/tmp'}/complex-${page.context().browser().browserType().name()}.png`,
  });
  return {
    toolAnchorShiftPx,
    detailAnchorShiftPx,
    agentAnchorShiftPx,
    nestedGroupShiftPx,
    nestedDetailShiftPx,
    ...outputScroll,
    subagentScrollErrorPx: nestedScroll.nestedScrollErrorPx,
    subagentParentJumpPx: nestedScroll.parentScrollJumpPx,
  };
}
