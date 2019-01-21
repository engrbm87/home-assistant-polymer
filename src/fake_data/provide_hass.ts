import { fireEvent } from "../common/dom/fire_event";
import applyThemesOnElement from "../common/dom/apply_themes_on_element";

import { demoConfig } from "./demo_config";
import { demoServices } from "./demo_services";
import { demoPanels } from "./demo_panels";
import { getEntity, Entity } from "./entity";
import { HomeAssistant } from "../types";
import { HassEntities } from "home-assistant-js-websocket";
import { getActiveTranslation } from "../util/hass-translation";
import { translationMetadata } from "../resources/translations-metadata";

const ensureArray = <T>(val: T | T[]): T[] =>
  Array.isArray(val) ? val : [val];

type RestCallback = (
  method: string,
  path: string,
  parameters: { [key: string]: any } | undefined
) => any;

export interface MockHomeAssistant extends HomeAssistant {
  mockEntities: any;
  updateHass(obj: Partial<MockHomeAssistant>);
  updateStates(newStates: HassEntities);
  addEntities(entites: Entity | Entity[], replace?: boolean);
  mockWS(type: string, callback: (msg: any) => any);
  mockAPI(path: string | RegExp, callback: RestCallback);
  mockEvent(event);
  mockTheme(theme: { [key: string]: string } | null);
}

export const provideHass = (
  elements,
  overrideData: Partial<HomeAssistant> = {}
): MockHomeAssistant => {
  elements = ensureArray(elements);
  // Can happen because we store sidebar, more info etc on hass.
  const hass = (): MockHomeAssistant => elements[0].hass;

  const wsCommands = {};
  const restResponses: Array<[string | RegExp, RestCallback]> = [];
  const eventListeners: {
    [event: string]: Array<(event) => void>;
  } = {};
  const entities = {};

  function updateStates(newStates: HassEntities) {
    hass().updateHass({
      states: { ...hass().states, ...newStates },
    });
  }

  function addEntities(newEntities, replace: boolean = false) {
    const states = {};
    ensureArray(newEntities).forEach((ent) => {
      ent.hass = hass();
      entities[ent.entityId] = ent;
      states[ent.entityId] = ent.toState();
    });
    if (replace) {
      hass().updateHass({
        states,
      });
    } else {
      updateStates(states);
    }
  }

  function mockAPI(path, callback) {
    restResponses.push([path, callback]);
  }

  mockAPI(new RegExp("states/.+"), (
    // @ts-ignore
    method,
    path,
    parameters
  ) => {
    const [domain, objectId] = path.substr(7).split(".", 2);
    if (!domain || !objectId) {
      return;
    }
    addEntities(
      getEntity(domain, objectId, parameters.state, parameters.attributes)
    );
  });

  const hassObj: MockHomeAssistant = {
    // Home Assistant properties
    auth: {} as any,
    connection: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      sendMessagePromise: () =>
        new Promise(() => {
          /* we never resolve */
        }),
      subscribeEvents: async (
        // @ts-ignore
        callback,
        event
      ) => {
        if (!(event in eventListeners)) {
          eventListeners[event] = [];
        }
        eventListeners[event].push(callback);
        return () => {
          eventListeners[event] = eventListeners[event].filter(
            (cb) => cb !== callback
          );
        };
      },
      socket: {
        readyState: WebSocket.OPEN,
      },
    } as any,
    connected: true,
    states: {},
    config: demoConfig,
    themes: {
      default_theme: "default",
      themes: {},
    },
    panels: demoPanels,
    services: demoServices,
    user: {
      credentials: [],
      id: "abcd",
      is_owner: true,
      mfa_modules: [],
      name: "Demo User",
    },
    panelUrl: "lovelace",

    language: getActiveTranslation(),
    resources: null as any,

    translationMetadata: translationMetadata as any,
    dockedSidebar: false,
    moreInfoEntityId: null as any,
    async callService(domain, service, data) {
      fireEvent(elements[0], "hass-notification", {
        message: `Called service ${domain}/${service}`,
      });
      if (data && "entity_id" in data) {
        await Promise.all(
          ensureArray(data.entity_id).map((ent) =>
            entities[ent].handleService(domain, service, data)
          )
        );
      } else {
        // tslint:disable-next-line
        console.log("unmocked callService", domain, service, data);
      }
    },
    async callApi(method, path, parameters) {
      const response = restResponses.find(([resPath]) =>
        typeof resPath === "string" ? path === resPath : resPath.test(path)
      );

      return response
        ? response[1](method, path, parameters)
        : Promise.reject(`API Mock for ${path} is not implemented`);
    },
    fetchWithAuth: () => Promise.reject("Not implemented"),
    async sendWS(msg) {
      const callback = wsCommands[msg.type];

      if (callback) {
        callback(msg);
      } else {
        // tslint:disable-next-line
        console.error(`Unknown WS command: ${msg.type}`);
      }
      // tslint:disable-next-line
      console.log("sendWS", msg);
    },
    async callWS(msg) {
      const callback = wsCommands[msg.type];
      return callback
        ? callback(msg)
        : Promise.reject({
            code: "command_not_mocked",
            message: `WS Command ${
              msg.type
            } is not implemented in provide_hass.`,
          });
    },

    // Mock stuff
    mockEntities: entities,
    updateHass(obj: Partial<MockHomeAssistant>) {
      const newHass = { ...hass(), ...obj };
      elements.forEach((el) => {
        el.hass = newHass;
      });
    },
    updateStates,
    addEntities,
    mockWS(type, callback) {
      wsCommands[type] = callback;
    },
    mockAPI,
    mockEvent(event) {
      (eventListeners[event] || []).forEach((fn) => fn(event));
    },
    mockTheme(theme) {
      hass().updateHass({
        selectedTheme: theme ? "mock" : "default",
        themes: {
          ...hass().themes,
          themes: {
            mock: theme as any,
          },
        },
      });
      const { themes, selectedTheme } = hass();
      applyThemesOnElement(
        document.documentElement,
        themes,
        selectedTheme,
        true
      );
    },

    ...overrideData,
  };

  // Update the elements. Note, we call it on hassObj so that if it was
  // overridden (like in the demo), it will still work.
  hassObj.updateHass(hassObj);

  // @ts-ignore
  return hassObj;
};