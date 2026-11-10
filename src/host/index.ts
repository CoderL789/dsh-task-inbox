/**
 * Host half of the DSH Task Inbox bundle.
 *
 * Task 01 keeps this half intentionally empty: todo storage, workspace and
 * session dispatch, and execution tracking arrive in later phases. The module
 * already exists so the Host/Client split, the bundle patch row, and the build
 * layout are fixed from the first version.
 *
 * The Client half is declared in package.json under `dsh.client` and registers
 * the sidebar entry and the page; it needs no Host service yet.
 */
export function apply(): void {
  // No Host-side resources are registered in Task 01.
}
