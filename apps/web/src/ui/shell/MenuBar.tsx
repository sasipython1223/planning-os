const MENU_GROUPS = ['File', 'Import', 'View', 'Schedule', 'Diagnostics', 'AI Review', 'Settings'];

export function MenuBar() {
  return (
    <div className="r3-menu-bar" role="navigation" aria-label="Application menu">
      {MENU_GROUPS.map((group) => (
        <button key={group} type="button" className="r3-menu-button">
          {group}
        </button>
      ))}
    </div>
  );
}
