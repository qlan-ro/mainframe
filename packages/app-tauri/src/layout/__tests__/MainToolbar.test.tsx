import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '@/store/theme';
import { MainToolbar } from '../MainToolbar';

beforeEach(() => {
  localStorage.clear();
  useTheme.getState().setMode('light');
});

describe('MainToolbar — root element', () => {
  it('renders the main-toolbar root with a drag region', () => {
    render(<MainToolbar leadingInset={0} sidebarRendered={true} onExpandSidebar={vi.fn()} projectName="mainframe" />);

    const toolbar = screen.getByTestId('main-toolbar');
    expect(toolbar).toBeDefined();
    expect(toolbar.hasAttribute('data-tauri-drag-region')).toBe(true);
  });
});

describe('MainToolbar — project name', () => {
  it('renders the project name text', () => {
    render(<MainToolbar leadingInset={0} sidebarRendered={true} onExpandSidebar={vi.fn()} projectName="mainframe" />);

    expect(screen.getByText('mainframe')).toBeDefined();
  });
});

describe('MainToolbar — branch chip', () => {
  it('renders main-toolbar-branch containing the branch name when branchName is given', () => {
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={true}
        onExpandSidebar={vi.fn()}
        projectName="mainframe"
        branchName="feat/x"
      />,
    );

    const chip = screen.getByTestId('main-toolbar-branch');
    expect(chip.textContent).toContain('feat/x');
    expect(chip).toBeDisabled();
  });

  it('does not render main-toolbar-branch when branchName is absent', () => {
    render(<MainToolbar leadingInset={0} sidebarRendered={true} onExpandSidebar={vi.fn()} projectName="mainframe" />);

    expect(screen.queryByTestId('main-toolbar-branch')).toBeNull();
  });
});

describe('MainToolbar — show-sidebar button', () => {
  it('renders show-sidebar-button and calls onExpandSidebar when sidebarRendered is false', () => {
    const onExpandSidebar = vi.fn();
    render(
      <MainToolbar
        leadingInset={0}
        sidebarRendered={false}
        onExpandSidebar={onExpandSidebar}
        projectName="mainframe"
      />,
    );

    const btn = screen.getByTestId('show-sidebar-button');
    expect(btn).toBeDefined();

    fireEvent.click(btn);

    expect(onExpandSidebar).toHaveBeenCalledTimes(1);
  });

  it('does not render show-sidebar-button when sidebarRendered is true', () => {
    render(<MainToolbar leadingInset={0} sidebarRendered={true} onExpandSidebar={vi.fn()} projectName="mainframe" />);

    expect(screen.queryByTestId('show-sidebar-button')).toBeNull();
  });
});

describe('MainToolbar — stub buttons', () => {
  it('renders search, launch, play, and inspector stub buttons all disabled', () => {
    render(<MainToolbar leadingInset={0} sidebarRendered={true} onExpandSidebar={vi.fn()} projectName="mainframe" />);

    expect(screen.getByTestId('main-toolbar-search')).toBeDisabled();
    expect(screen.getByTestId('main-toolbar-launch')).toBeDisabled();
    expect(screen.getByTestId('main-toolbar-play')).toBeDisabled();
    expect(screen.getByTestId('main-toolbar-inspector')).toBeDisabled();
  });
});

describe('MainToolbar — theme toggle', () => {
  it('clicking main-toolbar-theme flips the theme mode from light to dark', () => {
    render(<MainToolbar leadingInset={0} sidebarRendered={true} onExpandSidebar={vi.fn()} projectName="mainframe" />);

    expect(useTheme.getState().mode).toBe('light');

    fireEvent.click(screen.getByTestId('main-toolbar-theme'));

    expect(useTheme.getState().mode).toBe('dark');
  });

  it('main-toolbar-theme is not disabled', () => {
    render(<MainToolbar leadingInset={0} sidebarRendered={true} onExpandSidebar={vi.fn()} projectName="mainframe" />);

    expect(screen.getByTestId('main-toolbar-theme')).not.toBeDisabled();
  });
});
