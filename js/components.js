// js/components.js
import { getLoadableAvatarSrc } from './components-utils.js';
import { AuthUI } from './components-auth.js';
import { DashboardComponents } from './components-dashboard.js';
import { ClassComponents } from './components-class.js';

export { getLoadableAvatarSrc };

export const Components = {
    renderLogin: AuthUI.renderLogin,
    renderRegister: AuthUI.renderRegister,
    renderDashboard: DashboardComponents.renderDashboard,
    renderClassScreen: ClassComponents.renderClassScreen
};
