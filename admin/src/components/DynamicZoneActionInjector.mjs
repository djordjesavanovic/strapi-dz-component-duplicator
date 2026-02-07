import React from 'react';
import { useNotification } from '@strapi/admin/strapi-admin';
import { unstable_useContentManagerContext as useContentManagerContext } from '@strapi/content-manager/strapi-admin';
import { useIntl } from 'react-intl';

const DUPLICATE_CONTAINER_ATTR = 'data-dz-component-duplicator-action';
const INDEX_SEGMENT_REGEX = /^\d+$/;
const DUPLICATE_ICON_PATH =
  'M27 4H11a1 1 0 0 0-1 1v5H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5h5a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1m-1 16h-4v-9a1 1 0 0 0-1-1h-9V6h14z';

const isPlainObject = (value) => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const getIn = (source, dottedPath) => {
  if (!dottedPath) {
    return source;
  }

  const segments = dottedPath.split('.');
  let current = source;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (INDEX_SEGMENT_REGEX.test(segment)) {
      if (!Array.isArray(current)) {
        return undefined;
      }

      current = current[Number(segment)];
      continue;
    }

    current = current[segment];
  }

  return current;
};

const isDynamicZoneItem = (value) => {
  return isPlainObject(value) && typeof value.__component === 'string';
};

const collectDynamicZonePaths = (value, currentPath = '', acc = []) => {
  if (Array.isArray(value)) {
    if (currentPath && value.length > 0 && value.every(isDynamicZoneItem)) {
      acc.push(currentPath);
    }

    for (let index = 0; index < value.length; index += 1) {
      const nestedPath = currentPath ? `${currentPath}.${index}` : `${index}`;
      collectDynamicZonePaths(value[index], nestedPath, acc);
    }

    return acc;
  }

  if (!isPlainObject(value)) {
    return acc;
  }

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = currentPath ? `${currentPath}.${key}` : key;
    collectDynamicZonePaths(nested, nestedPath, acc);
  }

  return acc;
};

const cloneValue = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const stripTransientKeys = (value) => {
  if (Array.isArray(value)) {
    return value.map(stripTransientKeys);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const next = {};

  for (const [key, nested] of Object.entries(value)) {
    if (key === 'id' || key === 'documentId' || key === '__temp_key__') {
      continue;
    }

    next[key] = stripTransientKeys(nested);
  }

  return next;
};

const getActionAnchor = (listItem) => {
  const header = listItem.querySelector('h3');

  if (!header) {
    return null;
  }

  const buttons = header.querySelectorAll('button');

  // Dynamic zone headers include delete, drag and more-actions controls.
  // Repeatable components usually don't include the extra menu action.
  if (buttons.length < 3) {
    return null;
  }

  return buttons[1];
};

const findDynamicZoneLocationFromFields = (listItem, values) => {
  const fields = Array.from(listItem.querySelectorAll('[name]'))
    .map((element) => element.getAttribute('name') || '')
    .filter(Boolean)
    .sort((a, b) => a.length - b.length);

  for (const fieldName of fields) {
    const segments = fieldName.split('.');

    for (let indexPosition = segments.length - 2; indexPosition >= 0; indexPosition -= 1) {
      const segment = segments[indexPosition];

      if (!INDEX_SEGMENT_REGEX.test(segment)) {
        continue;
      }

      const itemPath = segments.slice(0, indexPosition + 1).join('.');
      const itemValue = getIn(values, itemPath);

      if (isDynamicZoneItem(itemValue)) {
        return {
          dynamicZonePath: segments.slice(0, indexPosition).join('.'),
          index: Number(segment),
        };
      }
    }
  }

  return null;
};

const findDynamicZoneLocationFromList = (listItem, values, components) => {
  const list = listItem.closest('ol');

  if (!list) {
    return null;
  }

  const siblings = Array.from(list.children).filter((node) => node.tagName === 'LI');
  const index = siblings.indexOf(listItem);

  if (index < 0) {
    return null;
  }

  const listLength = siblings.length;
  const dynamicZonePaths = collectDynamicZonePaths(values);
  const candidates = dynamicZonePaths.filter((dynamicZonePath) => {
    const zone = getIn(values, dynamicZonePath);

    return (
      Array.isArray(zone) &&
      zone.length === listLength &&
      isDynamicZoneItem(getIn(values, `${dynamicZonePath}.${index}`))
    );
  });

  if (candidates.length === 1) {
    return {
      dynamicZonePath: candidates[0],
      index,
    };
  }

  if (!components || !isPlainObject(components)) {
    return null;
  }

  const listItemText = (listItem.textContent || '').toLowerCase();
  const byDisplayName = candidates.filter((dynamicZonePath) => {
    const uid = getIn(values, `${dynamicZonePath}.${index}.__component`);
    const displayName = components?.[uid]?.info?.displayName;

    return typeof displayName === 'string' && listItemText.includes(displayName.toLowerCase());
  });

  if (byDisplayName.length === 1) {
    return {
      dynamicZonePath: byDisplayName[0],
      index,
    };
  }

  return null;
};

const findDynamicZoneLocation = (listItem, values, components) => {
  const locationFromFields = findDynamicZoneLocationFromFields(listItem, values);

  if (locationFromFields) {
    return locationFromFields;
  }

  return findDynamicZoneLocationFromList(listItem, values, components);
};

const createDuplicateButton = (anchor, label, onClick) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = anchor.className;
  button.setAttribute(DUPLICATE_CONTAINER_ATTR, 'true');
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.setAttribute('data-state', 'closed');

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  icon.setAttribute('viewBox', '0 0 32 32');
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  icon.setAttribute('fill', 'currentColor');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', DUPLICATE_ICON_PATH);
  icon.appendChild(path);

  const textTemplate = anchor.querySelector('span');
  const text = document.createElement('span');
  if (textTemplate?.className) {
    text.className = textTemplate.className;
  }
  text.textContent = label;

  button.append(icon, text);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });

  return button;
};

const DynamicZoneActionInjector = () => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const { form, isLoading, components } = useContentManagerContext();

  const values = form?.values;
  const valuesRef = React.useRef(values);
  const observerRef = React.useRef(null);

  valuesRef.current = values;

  const duplicateLabel = formatMessage({
    id: 'strapi-dz-component-duplicator.action.duplicate',
    defaultMessage: 'Duplicate component',
  });

  const duplicateErrorLabel = formatMessage({
    id: 'strapi-dz-component-duplicator.error.duplicate',
    defaultMessage: 'Could not duplicate this component.',
  });

  const cleanupInjectedButtons = React.useCallback(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const injectedNodes = document.querySelectorAll(`[${DUPLICATE_CONTAINER_ATTR}]`);
    for (const node of injectedNodes) {
      node.remove();
    }
  }, []);

  const handleDuplicate = React.useCallback(
    (dynamicZonePath, index) => {
      if (!form || typeof form.addFieldRow !== 'function') {
        return;
      }

      const item = getIn(valuesRef.current, `${dynamicZonePath}.${index}`);

      if (!isDynamicZoneItem(item)) {
        return;
      }

      try {
        const cloned = stripTransientKeys(cloneValue(item));
        form.addFieldRow(dynamicZonePath, cloned, index + 1);
      } catch {
        toggleNotification({
          type: 'danger',
          message: duplicateErrorLabel,
        });
      }
    },
    [form, toggleNotification, duplicateErrorLabel]
  );

  const injectButtons = React.useCallback(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const observer = observerRef.current;

    if (observer) {
      observer.disconnect();
    }

    cleanupInjectedButtons();

    const currentValues = valuesRef.current;

    if (!currentValues || isLoading) {
      if (observer) {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      }

      return;
    }

    const listItems = document.querySelectorAll('ol > li');

    for (const listItem of listItems) {
      const location = findDynamicZoneLocation(listItem, currentValues, components);

      if (!location) {
        continue;
      }

      const anchor = getActionAnchor(listItem);

      if (!anchor || !anchor.parentElement) {
        continue;
      }

      const duplicateButton = createDuplicateButton(anchor, duplicateLabel, () => {
        handleDuplicate(location.dynamicZonePath, location.index);
      });
      anchor.parentElement.insertBefore(
        duplicateButton,
        anchor
      );
    }

    if (observer) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }, [cleanupInjectedButtons, duplicateLabel, handleDuplicate, isLoading]);

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const observer = new MutationObserver(() => {
      injectButtons();
    });

    observerRef.current = observer;

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    injectButtons();

    return () => {
      observer.disconnect();
      observerRef.current = null;
      cleanupInjectedButtons();
    };
  }, [cleanupInjectedButtons, injectButtons]);

  React.useEffect(() => {
    injectButtons();
  }, [injectButtons, values]);

  return null;
};

export { DynamicZoneActionInjector };
