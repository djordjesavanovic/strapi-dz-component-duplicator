import { PLUGIN_ID } from './pluginId.mjs';
import { DynamicZoneActionInjector } from './components/DynamicZoneActionInjector.mjs';

const plugin = {
  register(app) {
    app.registerPlugin({
      id: PLUGIN_ID,
      name: PLUGIN_ID,
    });
  },

  bootstrap(app) {
    const contentManager = app.getPlugin('content-manager');

    if (!contentManager || typeof contentManager.injectComponent !== 'function') {
      return;
    }

    const injectionZone = 'right-links';
    const injectorName = `${PLUGIN_ID}-dynamic-zone-action-injector`;
    const existing =
      typeof contentManager.getInjectedComponents === 'function'
        ? contentManager.getInjectedComponents('editView', injectionZone)
        : [];

    if (Array.isArray(existing) && existing.some((component) => component.name === injectorName)) {
      return;
    }

    contentManager.injectComponent('editView', injectionZone, {
      name: injectorName,
      Component: DynamicZoneActionInjector,
    });
  },
};

export default plugin;
