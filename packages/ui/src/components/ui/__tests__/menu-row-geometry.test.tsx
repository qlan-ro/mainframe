/**
 * Menu-row geometry contract for the dormant dropdown/context sub-variants (audit 16.3).
 *
 * Every menu-row-shaped element must compose the shared `menuItemVariants()` token
 * (gap-[9px] rounded-sm px-[8px] py-[7px]) instead of the stock shadcn `px-2 py-1.5
 * text-body` geometry. `DropdownMenuSubContent` must use the canonical
 * `MENU_CONTENT_PADDING` (`p-[5px]`) instead of the stock `p-1`.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../context-menu';

function openContextMenu(triggerTestId: string) {
  fireEvent.contextMenu(screen.getByTestId(triggerTestId));
}

describe('DropdownMenu sub-variant geometry', () => {
  it('DropdownMenuCheckboxItem composes the shared menu-row token', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>trigger</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem data-testid="chk" checked>
            Bug
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const cls = screen.getByTestId('chk').className;
    expect(cls).toContain('gap-[9px]');
    expect(cls).toContain('px-[8px]');
    expect(cls).toContain('py-[7px]');
  });

  it('DropdownMenuRadioItem composes the shared menu-row token', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>trigger</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem data-testid="radio" value="a">
              A
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const cls = screen.getByTestId('radio').className;
    expect(cls).toContain('gap-[9px]');
    expect(cls).toContain('px-[8px]');
    expect(cls).toContain('py-[7px]');
  });

  it('DropdownMenuSubTrigger composes the shared menu-row token', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>trigger</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="sub-trigger">More</DropdownMenuSubTrigger>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const cls = screen.getByTestId('sub-trigger').className;
    expect(cls).toContain('gap-[9px]');
    expect(cls).toContain('px-[8px]');
    expect(cls).toContain('py-[7px]');
  });

  it('DropdownMenuSubContent uses the canonical MENU_CONTENT_PADDING', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>trigger</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-testid="sub-content">inner</DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const cls = screen.getByTestId('sub-content').className;
    expect(cls).toContain('p-[5px]');
    expect(cls.split(' ')).not.toContain('p-1');
  });
});

describe('ContextMenu sub-variant geometry', () => {
  it('ContextMenuSubTrigger composes the shared menu-row token', () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger data-testid="ctx-trigger">trigger</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuSub>
            <ContextMenuSubTrigger data-testid="ctx-sub-trigger">More</ContextMenuSubTrigger>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>,
    );
    openContextMenu('ctx-trigger');
    const cls = screen.getByTestId('ctx-sub-trigger').className;
    expect(cls).toContain('gap-[9px]');
    expect(cls).toContain('px-[8px]');
    expect(cls).toContain('py-[7px]');
  });
});
