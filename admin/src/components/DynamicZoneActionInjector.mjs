import React from 'react';
import { useFetchClient, useNotification, useQueryParams } from '@strapi/admin/strapi-admin';
import {
  buildValidParams,
  unstable_useContentManagerContext as useContentManagerContext,
} from '@strapi/content-manager/strapi-admin';
import { useIntl } from 'react-intl';

const DUPLICATE_CONTAINER_ATTR = 'data-dz-component-duplicator-action';
const INDEX_SEGMENT_REGEX = /^\d+$/;
const COLLECTION_TYPES = 'collection-types';
const SINGLE_TYPES = 'single-types';
const ONE_WAY_RELATIONS = new Set([
  'oneWay',
  'oneToOne',
  'manyToOne',
  'oneToManyMorph',
  'oneToOneMorph',
]);
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

const isMediaObject = (value) => {
  return isPlainObject(value) && typeof value.mime === 'string';
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

const createTempKeyFactory = () => {
  let counter = 0;
  const seed =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return () => `${String(counter++).padStart(4, '0')}-${seed}`;
};

const getActionAnchor = (listItem) => {
  const header = listItem.querySelector('h3');

  if (!header) {
    return null;
  }

  const dragButton =
    header.querySelector('button[aria-label="Drag"]') ||
    header.querySelector('button[aria-label="drag"]');

  if (dragButton) {
    return dragButton;
  }

  const buttons = header.querySelectorAll('button');

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

const createDuplicateButton = (anchor, label, onClick, signal) => {
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
  button.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      void onClick();
    },
    { signal }
  );

  return button;
};

const getRelationIdentity = (relation) => {
  if (!isPlainObject(relation)) {
    return null;
  }

  const documentId = relation.documentId ?? relation.apiData?.documentId;
  const locale = relation.locale ?? relation.apiData?.locale ?? '';
  const id = relation.id ?? relation.apiData?.id;

  if (documentId) {
    return `${documentId}::${locale}`;
  }

  if (id !== null && id !== undefined) {
    return `id:${id}`;
  }

  return null;
};

const getRelationDisplayValue = (relation) => {
  const candidateKeys = [
    'label',
    'title',
    'name',
    'displayName',
    'question',
    'heading',
    'slug',
    'documentId',
    'id',
  ];

  for (const key of candidateKeys) {
    const value = relation?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value;
    }

    if (typeof value === 'number') {
      return String(value);
    }
  }

  return '';
};

const getRelationCollectionType = (targetModel, contentTypes) => {
  const targetSchema = Array.isArray(contentTypes)
    ? contentTypes.find((schema) => schema?.uid === targetModel)
    : null;

  return targetSchema?.kind === 'singleType' ? SINGLE_TYPES : COLLECTION_TYPES;
};

const getRelationHref = (targetModel, contentTypes, documentId, locale) => {
  if (!targetModel || !documentId) {
    return undefined;
  }

  const collectionType = getRelationCollectionType(targetModel, contentTypes);
  const basePath =
    collectionType === SINGLE_TYPES
      ? `../${SINGLE_TYPES}/${targetModel}`
      : `../${COLLECTION_TYPES}/${targetModel}/${documentId}`;

  return locale ? `${basePath}?plugins[i18n][locale]=${locale}` : basePath;
};

const normalizeFetchedRelations = (value) => {
  if (Array.isArray(value)) {
    return value.filter(isPlainObject);
  }

  if (isPlainObject(value) && Array.isArray(value.results)) {
    return value.results.filter(isPlainObject);
  }

  if (isPlainObject(value)) {
    return [value];
  }

  return [];
};

const toRelationConnectEntry = (relation, attribute, contentTypes, createTempKey) => {
  if (!isPlainObject(relation)) {
    return null;
  }

  const id = relation.id ?? relation.apiData?.id;
  const documentId = relation.documentId ?? relation.apiData?.documentId;
  const locale = relation.locale ?? relation.apiData?.locale ?? null;
  const label = relation.label ?? getRelationDisplayValue(relation);
  const href = relation.href ?? getRelationHref(attribute.target, contentTypes, documentId, locale);
  const next = {
    id,
    documentId,
    locale,
    href,
    label: label || documentId || (id !== undefined && id !== null ? String(id) : ''),
    __temp_key__: createTempKey(),
    apiData: {
      id,
      locale,
    },
  };

  if (relation.status !== undefined) {
    next.status = relation.status;
  } else if (typeof relation.publishedAt === 'string') {
    next.status = 'published';
  }

  return next;
};

const sanitizeRelationValue = async ({
  attribute,
  value,
  sourceContext,
  fieldName,
  contentTypes,
  createTempKey,
  fetchRelationItems,
}) => {
  const currentConnect = Array.isArray(value?.connect) ? value.connect : [];
  const currentDisconnect = Array.isArray(value?.disconnect) ? value.disconnect : [];
  const fetchedRelations =
    sourceContext?.id && sourceContext?.model
      ? await fetchRelationItems(sourceContext.model, sourceContext.id, fieldName)
      : [];

  const connectedByIdentity = new Map();

  for (const relation of currentConnect) {
    const entry = toRelationConnectEntry(relation, attribute, contentTypes, createTempKey);
    const identity = getRelationIdentity(entry);

    if (entry && identity) {
      connectedByIdentity.set(identity, entry);
    }
  }

  const disconnectedIdentities = new Set(
    currentDisconnect.map(getRelationIdentity).filter(Boolean)
  );

  const effectiveRelations = [];

  for (const relation of fetchedRelations) {
    const entry = toRelationConnectEntry(relation, attribute, contentTypes, createTempKey);
    const identity = getRelationIdentity(entry);

    if (!entry || !identity || disconnectedIdentities.has(identity)) {
      continue;
    }

    if (connectedByIdentity.has(identity)) {
      effectiveRelations.push(connectedByIdentity.get(identity));
      connectedByIdentity.delete(identity);
      continue;
    }

    effectiveRelations.push(entry);
  }

  for (const relation of connectedByIdentity.values()) {
    effectiveRelations.push(relation);
  }

  const connect = ONE_WAY_RELATIONS.has(attribute.relation)
    ? effectiveRelations.slice(-1)
    : effectiveRelations;

  return {
    connect,
    disconnect: [],
  };
};

const sanitizeComponentValue = async ({
  value,
  componentUid,
  components,
  contentTypes,
  createTempKey,
  fetchRelationItems,
  sourceContext,
}) => {
  if (!isPlainObject(value)) {
    return value;
  }

  const attributes = components?.[componentUid]?.attributes ?? {};
  const next = {};

  for (const [fieldName, attribute] of Object.entries(attributes)) {
    if (fieldName === 'id' || !(fieldName in value)) {
      continue;
    }

    next[fieldName] = await sanitizeAttributeValue({
      attribute,
      fieldName,
      value: value[fieldName],
      components,
      contentTypes,
      createTempKey,
      fetchRelationItems,
      sourceContext: {
        model: componentUid,
        id: sourceContext?.id ?? value?.id,
      },
    });
  }

  return next;
};

const sanitizeDynamicZoneValue = async ({
  value,
  components,
  contentTypes,
  createTempKey,
  fetchRelationItems,
}) => {
  if (!isDynamicZoneItem(value)) {
    return value;
  }

  const componentUid = value.__component;
  const next = await sanitizeComponentValue({
    value,
    componentUid,
    components,
    contentTypes,
    createTempKey,
    fetchRelationItems,
    sourceContext: {
      model: componentUid,
      id: value?.id,
    },
  });

  return {
    __component: componentUid,
    ...next,
  };
};

const sanitizeAttributeValue = async ({
  attribute,
  fieldName,
  value,
  components,
  contentTypes,
  createTempKey,
  fetchRelationItems,
  sourceContext,
}) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (attribute.type === 'component') {
    if (attribute.repeatable) {
      if (!Array.isArray(value)) {
        return [];
      }

      const next = await Promise.all(
        value.map((item) =>
          sanitizeComponentValue({
            value: item,
            componentUid: attribute.component,
            components,
            contentTypes,
            createTempKey,
            fetchRelationItems,
            sourceContext: {
              model: attribute.component,
              id: item?.id,
            },
          })
        )
      );

      return next.map((item) =>
        isPlainObject(item)
          ? {
              ...item,
              __temp_key__: createTempKey(),
            }
          : item
      );
    }

    return sanitizeComponentValue({
      value,
      componentUid: attribute.component,
      components,
      contentTypes,
      createTempKey,
      fetchRelationItems,
      sourceContext: {
        model: attribute.component,
        id: value?.id,
      },
    });
  }

  if (attribute.type === 'dynamiczone') {
    if (!Array.isArray(value)) {
      return [];
    }

    const next = await Promise.all(
      value.map((item) =>
        sanitizeDynamicZoneValue({
          value: item,
          components,
          contentTypes,
          createTempKey,
          fetchRelationItems,
        })
      )
    );

    return next.map((item) =>
      isPlainObject(item)
        ? {
            ...item,
            __temp_key__: createTempKey(),
          }
        : item
    );
  }

  if (attribute.type === 'relation') {
    return sanitizeRelationValue({
      attribute,
      value,
      sourceContext,
      fieldName,
      contentTypes,
      createTempKey,
      fetchRelationItems,
    });
  }

  if (attribute.type === 'media') {
    return cloneValue(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }

  if (isPlainObject(value)) {
    if (isMediaObject(value)) {
      return cloneValue(value);
    }

    return cloneValue(value);
  }

  return value;
};

const DynamicZoneActionInjector = () => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const { get } = useFetchClient();
  const [{ query }] = useQueryParams();
  const { form, isLoading, components, contentTypes, model, collectionType, id } =
    useContentManagerContext();

  const isBrowser = typeof document !== 'undefined';
  const values = form?.values;
  const valuesRef = React.useRef(values);
  const observerRef = React.useRef(null);
  const frameRef = React.useRef(0);
  const abortRef = React.useRef(null);
  const relationCacheRef = React.useRef(new Map());

  valuesRef.current = values;

  const relationQueryParams = React.useMemo(() => {
    const params = buildValidParams(query ?? {});

    return {
      locale: params?.locale,
      status: params?.status,
    };
  }, [query]);

  const duplicateLabel = formatMessage({
    id: 'strapi-dz-component-duplicator.action.duplicate',
    defaultMessage: 'Duplicate component',
  });

  const duplicateErrorLabel = formatMessage({
    id: 'strapi-dz-component-duplicator.error.duplicate',
    defaultMessage: 'Could not duplicate this component.',
  });

  const fetchRelationItems = React.useCallback(
    async (relationModel, relationId, fieldName) => {
      if (!relationModel || !relationId || !fieldName) {
        return [];
      }

      const cacheKey = JSON.stringify({
        relationModel,
        relationId,
        fieldName,
        relationQueryParams,
      });

      const cachedPromise = relationCacheRef.current.get(cacheKey);

      if (cachedPromise) {
        return cachedPromise;
      }

      const request = (async () => {
        let page = 1;
        let totalPages = 1;
        const relations = [];

        while (page <= totalPages) {
          const response = await get(
            `/content-manager/relations/${relationModel}/${relationId}/${fieldName}`,
            {
              params: {
                ...relationQueryParams,
                page,
                pageSize: 100,
              },
            }
          );
          const payload = response?.data ?? {};
          const pageResults = normalizeFetchedRelations(payload.results).reverse();

          relations.push(...pageResults);

          const pagination = payload?.pagination;
          const pageCount =
            typeof pagination?.pageCount === 'number'
              ? pagination.pageCount
              : Math.max(1, Math.ceil((pagination?.total ?? pageResults.length) / 100));

          totalPages = pageCount;
          page += 1;
        }

        return relations;
      })();

      relationCacheRef.current.set(cacheKey, request);

      try {
        return await request;
      } catch (error) {
        relationCacheRef.current.delete(cacheKey);
        throw error;
      }
    },
    [get, relationQueryParams]
  );

  const cleanupInjectedButtons = React.useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const injectedNodes = document.querySelectorAll(`[${DUPLICATE_CONTAINER_ATTR}]`);
    for (const node of injectedNodes) {
      node.remove();
    }
  }, []);

  const handleDuplicate = React.useCallback(
    async (dynamicZonePath, index) => {
      if (!form || typeof form.addFieldRow !== 'function') {
        return;
      }

      const item = getIn(valuesRef.current, `${dynamicZonePath}.${index}`);

      if (!isDynamicZoneItem(item)) {
        return;
      }

      try {
        relationCacheRef.current.clear();
        const createTempKey = createTempKeyFactory();
        const cloned = await sanitizeDynamicZoneValue({
          value: item,
          components,
          contentTypes,
          createTempKey,
          fetchRelationItems,
        });

        if (!isDynamicZoneItem(cloned)) {
          throw new Error('Invalid dynamic zone clone');
        }

        console.group('[DZ-Duplicator] Duplicate Debug');
        console.log('Original item:', JSON.parse(JSON.stringify(item)));
        console.log('Cloned item (before addFieldRow):', JSON.parse(JSON.stringify(cloned)));
        console.log('Inserting at path:', dynamicZonePath, 'position:', index + 1);
        console.log('Current DZ length:', getIn(valuesRef.current, dynamicZonePath)?.length);
        console.groupEnd();

        form.addFieldRow(dynamicZonePath, cloned, index + 1);
      } catch {
        toggleNotification({
          type: 'danger',
          message: duplicateErrorLabel,
        });
      }
    },
    [
      components,
      contentTypes,
      duplicateErrorLabel,
      fetchRelationItems,
      form,
      toggleNotification,
    ]
  );

  const injectButtons = React.useCallback(() => {
    if (!isBrowser) {
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

    const controller = new AbortController();
    abortRef.current = controller;

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

      const duplicateButton = createDuplicateButton(
        anchor,
        duplicateLabel,
        () => handleDuplicate(location.dynamicZonePath, location.index),
        controller.signal
      );
      anchor.parentElement.insertBefore(duplicateButton, anchor);
    }

    if (observer) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }, [cleanupInjectedButtons, components, duplicateLabel, handleDuplicate, isBrowser, isLoading]);

  React.useEffect(() => {
    relationCacheRef.current.clear();
  }, [id, model, collectionType, relationQueryParams]);

  React.useEffect(() => {
    if (!isBrowser) {
      return undefined;
    }

    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => injectButtons());
    });

    observerRef.current = observer;

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    injectButtons();

    return () => {
      cancelAnimationFrame(frameRef.current);
      observer.disconnect();
      observerRef.current = null;
      cleanupInjectedButtons();
    };
  }, [cleanupInjectedButtons, isBrowser, injectButtons]);

  return null;
};

export { DynamicZoneActionInjector };
