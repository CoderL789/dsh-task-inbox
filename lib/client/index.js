"use strict";
/**
 * Client half of the DSH Task Inbox bundle.
 *
 * The Harness Client module loader evaluates this file as a lazy factory whose
 * id equals the package name. Task 01 contributes only two things:
 *
 * - an independent entry in `sidebar.panellist` (the global panel icon list);
 *   the sidebar owns the button and dispatches `main` with this entry id, and
 * - a page registered in the keyed `main` slot under the same id, showing the
 *   plugin name and an empty state. Todo CRUD and Agent dispatch come later.
 *
 * Rules followed here: only theme tokens (`--dsw-alias-*`) for styling, visible
 * text routed through the Client locale service, no Harness Client package
 * imports, and no DOM writes outside the component.
 */
const PACKAGE_ID = 'dsh-task-inbox';
const PANEL_ID = 'task-inbox';
const LOCALE_NS = 'dsh-task-inbox';
const DICTIONARIES = {
    en: {
        'panel.label': 'Task Inbox',
        'page.title': 'Task Inbox',
        'page.subtitle': 'Collect tasks first, then dispatch them to a workspace session for an Agent to execute.',
        'empty.title': 'No tasks yet',
        'empty.description': 'Collected tasks will appear here. Task collection and dispatch arrive in later phases.',
    },
    zh: {
        'panel.label': '待办箱',
        'page.title': '待办箱',
        'page.subtitle': '先收集待办，执行时再选择工作区与会话，由 Agent 完成并追踪结果。',
        'empty.title': '暂无待办',
        'empty.description': '收集的待办会显示在这里，待办的添加与管理将在后续阶段提供。',
    },
};
window.__ModuleLoader__.load({
    id: PACKAGE_ID,
    factory(require) {
        const React = require('react');
        return {
            inject: ['slots', 'locale'],
            apply(ctx) {
                ctx.locale.register(LOCALE_NS, 'en', DICTIONARIES.en);
                ctx.locale.register(LOCALE_NS, 'zh', DICTIONARIES.zh);
                const t = () => ctx.locale.bind(LOCALE_NS);
                function TaskInboxIcon(props) {
                    const size = props.size ?? 18;
                    const color = props.active
                        ? 'var(--dsw-alias-brand-primary)'
                        : 'var(--dsw-alias-label-secondary)';
                    return React.createElement('svg', {
                        viewBox: '0 0 24 24',
                        width: size,
                        height: size,
                        fill: 'none',
                        stroke: color,
                        'stroke-width': '1.7',
                        'stroke-linecap': 'round',
                        'stroke-linejoin': 'round',
                        role: 'img',
                        'aria-hidden': true,
                        style: { display: 'block' },
                    }, React.createElement('path', {
                        d: 'M3.5 13.5 5 6.9A2 2 0 0 1 7 5.5h10a2 2 0 0 1 1.9 1.4l1.6 6.6',
                    }), React.createElement('path', {
                        d: 'M3.5 13.5v4a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4',
                    }), React.createElement('path', {
                        d: 'M7 13.5h2.6l1.3 2h2.2l1.3-2h2.6',
                    }), React.createElement('path', { d: 'm9.2 9.4 1.9 1.9 3.4-3.6' }));
                }
                function TaskInboxPage() {
                    // Re-render when the locale changes; `bind` reads the active locale
                    // at call time, so the same component stays localized after a switch.
                    const [, bumpRevision] = React.useState(0);
                    React.useEffect(() => ctx.locale.subscribe(() => bumpRevision((value) => value + 1)), []);
                    const pageStyle = {
                        height: '100%',
                        boxSizing: 'border-box',
                        padding: '32px 24px 48px',
                        overflowY: 'auto',
                        background: 'var(--dsw-alias-bg-base)',
                        color: 'var(--dsw-alias-label-primary)',
                    };
                    const headerStyle = {
                        maxWidth: '640px',
                        margin: '0 auto',
                    };
                    const titleStyle = {
                        margin: 0,
                        fontSize: '20px',
                        fontWeight: 600,
                        lineHeight: 1.3,
                    };
                    const subtitleStyle = {
                        margin: '6px 0 0',
                        fontSize: '13px',
                        lineHeight: 1.6,
                        color: 'var(--dsw-alias-label-secondary)',
                    };
                    const emptyCardStyle = {
                        maxWidth: '560px',
                        margin: '64px auto 0',
                        padding: '40px 32px',
                        boxSizing: 'border-box',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center',
                        border: '1px solid var(--dsw-alias-border-l1)',
                        borderRadius: '12px',
                        background: 'var(--dsw-alias-bg-layer-1)',
                    };
                    const emptyIconStyle = {
                        width: '64px',
                        height: '64px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '50%',
                        background: 'var(--dsw-alias-bg-layer-2)',
                    };
                    const emptyTitleStyle = {
                        margin: '16px 0 0',
                        fontSize: '16px',
                        fontWeight: 600,
                    };
                    const emptyTextStyle = {
                        margin: '8px 0 0',
                        maxWidth: '360px',
                        fontSize: '13px',
                        lineHeight: 1.6,
                        color: 'var(--dsw-alias-label-secondary)',
                    };
                    return React.createElement('section', { style: pageStyle, 'data-dsh-plugin': PACKAGE_ID }, React.createElement('header', { style: headerStyle }, React.createElement('h1', { style: titleStyle }, t()('page.title')), React.createElement('p', { style: subtitleStyle }, t()('page.subtitle'))), React.createElement('div', { style: emptyCardStyle }, React.createElement('div', { style: emptyIconStyle }, React.createElement(TaskInboxIcon, { size: 28, active: false })), React.createElement('h2', { style: emptyTitleStyle }, t()('empty.title')), React.createElement('p', { style: emptyTextStyle }, t()('empty.description'))));
                }
                ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
                    name: 'sidebar.panellist',
                    id: PANEL_ID,
                    order: 20,
                    label: () => t()('panel.label'),
                }, TaskInboxIcon));
                ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, TaskInboxPage));
            },
        };
    },
});
