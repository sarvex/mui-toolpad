import * as React from 'react';
import {
  Stack,
  CssBaseline,
  Alert,
  Box,
  styled,
  AlertTitle,
  LinearProgress,
  Container,
  Tooltip,
} from '@mui/material';
import {
  ToolpadComponent,
  createComponent,
  TOOLPAD_COMPONENT,
  Slots,
  Placeholder,
  NodeId,
  BindableAttrValue,
  NestedBindableAttrs,
} from '@mui/toolpad-core';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
  Navigate,
  Location as RouterLocation,
  useNavigate,
} from 'react-router-dom';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';
import {
  fireEvent,
  NodeErrorProps,
  NodeRuntimeWrapper,
  ResetNodeErrorsKeyProvider,
} from '@mui/toolpad-core/runtime';
import * as _ from 'lodash-es';
import ErrorIcon from '@mui/icons-material/Error';
import * as appDom from '../appDom';
import { RuntimeState, VersionOrPreview } from '../types';
import { createProvidedContext } from '../utils/react';
import {
  getElementNodeComponentId,
  isPageLayoutComponent,
  isPageRow,
  PAGE_ROW_COMPONENT_ID,
} from '../toolpadComponents';
import AppOverview from './AppOverview';
import AppThemeProvider from './AppThemeProvider';
import evalJsBindings, {
  BindingEvaluationResult,
  buildGlobalScope,
  evaluateExpression,
  ParsedBinding,
} from './evalJsBindings';
import { HTML_ID_EDITOR_OVERLAY } from '../constants';
import { mapProperties, mapValues } from '../utils/collections';
import usePageTitle from '../utils/usePageTitle';
import ComponentsContext, { useComponents, useComponent } from './ComponentsContext';
import { AppModulesProvider, useAppModules } from './AppModulesProvider';
import Pre from '../components/Pre';
import { layoutBoxArgTypes } from '../toolpadComponents/layoutBox';
import NoSsr from '../components/NoSsr';
import { execDataSourceQuery, useDataQuery, UseDataQueryConfig, UseFetch } from './useDataQuery';
import { useAppContext, AppContextProvider } from './AppContext';
import { CanvasHooksContext, NavigateToPage } from './CanvasHooksContext';
import useBoolean from '../utils/useBoolean';

const ReactQueryDevtoolsProduction = React.lazy(() =>
  import('@tanstack/react-query-devtools/build/lib/index.prod.js').then((d) => ({
    default: d.ReactQueryDevtools,
  })),
);

const EMPTY_ARRAY: any[] = [];
const EMPTY_OBJECT: any = {};

const INITIAL_FETCH: UseFetch = {
  call: async () => {},
  refetch: async () => {},
  fetch: async () => {},
  isLoading: false,
  isFetching: false,
  error: null,
  data: null,
  rows: [],
};

const USE_DATA_QUERY_CONFIG_KEYS: readonly (keyof UseDataQueryConfig)[] = [
  'enabled',
  'refetchInterval',
];

function usePageNavigator(): NavigateToPage {
  const navigate = useNavigate();
  const navigateToPage: NavigateToPage = React.useCallback(
    (pageNodeId: NodeId) => {
      navigate(`/pages/${pageNodeId}`);
    },
    [navigate],
  );

  const canvasHooks = React.useContext(CanvasHooksContext);
  return canvasHooks.navigateToPage || navigateToPage;
}

const AppRoot = styled('div')({
  overflow: 'auto' /* Prevents margins from collapsing into root */,
  position: 'relative' /* Makes sure that the editor overlay that renders inside sizes correctly */,
  minHeight: '100vh',
});

const EditorOverlay = styled('div')({
  position: 'absolute',
  inset: '0 0 0 0',
  pointerEvents: 'none',
  overflow: 'hidden',
});

type ToolpadComponents = Partial<Record<string, ToolpadComponent<any>>>;

const [useDomContext, DomContextProvider] = createProvidedContext<appDom.AppDom>('Dom');
const [useEvaluatePageExpression, EvaluatePageExpressionProvider] =
  createProvidedContext<(expr: string) => any>('EvaluatePageExpression');
const [useBindingsContext, BindingsContextProvider] =
  createProvidedContext<Record<string, BindingEvaluationResult>>('LiveBindings');
const [useSetControlledBindingContext, SetControlledBindingContextProvider] =
  createProvidedContext<(id: string, result: BindingEvaluationResult) => void>(
    'SetControlledBinding',
  );

function getComponentId(elm: appDom.ElementNode): string {
  const componentId = getElementNodeComponentId(elm);
  return componentId;
}

function useElmToolpadComponent(elm: appDom.ElementNode): ToolpadComponent {
  const componentId = getElementNodeComponentId(elm);
  return useComponent(componentId);
}

interface RenderedNodeProps {
  nodeId: NodeId;
}

function RenderedNode({ nodeId }: RenderedNodeProps) {
  const dom = useDomContext();
  const node = appDom.getNode(dom, nodeId, 'element');
  const Component: ToolpadComponent<any> = useElmToolpadComponent(node);
  const childNodeGroups = appDom.getChildNodes(dom, node);

  return (
    /* eslint-disable-next-line @typescript-eslint/no-use-before-define */
    <RenderedNodeContent node={node} childNodeGroups={childNodeGroups} Component={Component} />
  );
}

function NodeError({ error }: NodeErrorProps) {
  return (
    <Tooltip title={error.message}>
      <span
        style={{
          display: 'inline-flex',
          flexDirection: 'row',
          alignItems: 'center',
          padding: 8,
          background: 'red',
          color: 'white',
        }}
      >
        <ErrorIcon color="inherit" style={{ marginRight: 8 }} /> Error
      </span>
    </Tooltip>
  );
}

interface RenderedNodeContentProps {
  node: appDom.PageNode | appDom.ElementNode;
  childNodeGroups: appDom.NodeChildren<appDom.ElementNode>;
  Component: ToolpadComponent<any>;
}

function RenderedNodeContent({ node, childNodeGroups, Component }: RenderedNodeContentProps) {
  const setControlledBinding = useSetControlledBindingContext();

  const nodeId = node.id;

  const componentConfig = Component[TOOLPAD_COMPONENT];
  const { argTypes = {}, errorProp, loadingProp, loadingPropSource } = componentConfig;

  const isLayoutNode =
    appDom.isPage(node) || (appDom.isElement(node) && isPageLayoutComponent(node));

  const liveBindings = useBindingsContext();
  const boundProps: Record<string, any> = React.useMemo(() => {
    const loadingPropSourceSet = new Set(loadingPropSource);
    const hookResult: Record<string, any> = {};

    // error state we will propagate to the component
    let error: Error | undefined;
    // loading state we will propagate to the component
    let loading: boolean = false;

    for (const [propName, argType] of Object.entries(argTypes)) {
      const bindingId = `${nodeId}.props.${propName}`;
      const binding = liveBindings[bindingId];
      if (binding) {
        hookResult[propName] = binding.value;
        error = error || binding.error;

        if (binding.loading && loadingPropSourceSet.has(propName)) {
          loading = true;
        }
      }

      if (typeof hookResult[propName] === 'undefined' && argType) {
        hookResult[propName] = argType.defaultValue;
      }
    }

    if (error) {
      if (errorProp) {
        hookResult[errorProp] = error;
      } else {
        console.error(error);
      }
    }

    if (loadingProp && loading) {
      hookResult[loadingProp] = true;
    }

    return hookResult;
  }, [argTypes, errorProp, liveBindings, loadingProp, loadingPropSource, nodeId]);

  const boundLayoutProps: Record<string, any> = React.useMemo(() => {
    const hookResult: Record<string, any> = {};

    for (const [propName, argType] of isLayoutNode ? [] : Object.entries(layoutBoxArgTypes)) {
      const bindingId = `${nodeId}.layout.${propName}`;
      const binding = liveBindings[bindingId];
      if (binding) {
        hookResult[propName] = binding.value;
      }

      if (typeof hookResult[propName] === 'undefined' && argType) {
        hookResult[propName] = argType.defaultValue;
      }
    }

    return hookResult;
  }, [isLayoutNode, liveBindings, nodeId]);

  const onChangeHandlers: Record<string, (param: any) => void> = React.useMemo(
    () =>
      mapProperties(argTypes, ([key, argType]) => {
        if (!argType || !argType.onChangeProp) {
          return null;
        }

        const handler = (param: any) => {
          const bindingId = `${nodeId}.props.${key}`;
          const value = argType.onChangeHandler ? argType.onChangeHandler(param) : param;
          setControlledBinding(bindingId, { value });
        };
        return [argType.onChangeProp, handler];
      }),
    [argTypes, nodeId, setControlledBinding],
  );

  const navigateToPage = usePageNavigator();
  const evaluatePageExpression = useEvaluatePageExpression();

  const eventHandlers: Record<string, (param: any) => void> = React.useMemo(() => {
    return mapProperties(argTypes, ([key, argType]) => {
      if (!argType || argType.typeDef.type !== 'event' || !appDom.isElement(node)) {
        return null;
      }

      const action = (node as appDom.ElementNode).props?.[key];

      if (action?.type === 'navigationAction') {
        const handler = () => {
          const { page } = action.value;
          if (page) {
            navigateToPage(appDom.deref(page));
          }
        };

        return [key, handler];
      }

      if (action?.type === 'jsExpressionAction') {
        const handler = () => {
          const code = action.value;
          const exprToEvaluate = `(async () => {${code}})()`;
          evaluatePageExpression(exprToEvaluate);
        };

        return [key, handler];
      }

      return null;
    });
  }, [argTypes, node, navigateToPage, evaluatePageExpression]);

  const reactChildren = mapValues(childNodeGroups, (childNodes) =>
    childNodes.map((child) => <RenderedNode key={child.id} nodeId={child.id} />),
  );

  const layoutElementProps = React.useMemo(() => {
    if (appDom.isElement(node) && isPageRow(node)) {
      return {
        layoutColumnSizes: childNodeGroups.children.map((child) => child.layout?.columnSize?.value),
      };
    }
    return {};
  }, [childNodeGroups.children, node]);

  const props: Record<string, any> = React.useMemo(() => {
    return {
      ...boundProps,
      ...onChangeHandlers,
      ...eventHandlers,
      ...layoutElementProps,
      ...reactChildren,
    };
  }, [boundProps, eventHandlers, layoutElementProps, onChangeHandlers, reactChildren]);

  const previousProps = React.useRef<Record<string, any>>(props);
  React.useEffect(() => {
    Object.entries(argTypes).forEach(([key, argType]) => {
      if (!argType?.defaultValueProp) {
        return;
      }

      if (previousProps.current[argType.defaultValueProp] === props[argType.defaultValueProp]) {
        return;
      }

      const bindingIdToUpdate = `${nodeId}.props.${key}`;
      setControlledBinding(bindingIdToUpdate, { value: props[argType.defaultValueProp] });
    });

    previousProps.current = props;
  }, [props, argTypes, nodeId, setControlledBinding]);

  // Wrap with slots
  for (const [propName, argType] of Object.entries(argTypes)) {
    if (argType?.typeDef.type === 'element') {
      if (argType.control?.type === 'slots') {
        const value = props[propName];
        props[propName] = <Slots prop={propName}>{value}</Slots>;
      } else if (argType.control?.type === 'slot' || argType.control?.type === 'layoutSlot') {
        const value = props[propName];
        props[propName] = (
          <Placeholder prop={propName} hasLayout={argType.control?.type === 'layoutSlot'}>
            {value}
          </Placeholder>
        );
      }
    }
  }

  return (
    <NodeRuntimeWrapper
      nodeId={nodeId}
      componentConfig={Component[TOOLPAD_COMPONENT]}
      NodeError={NodeError}
    >
      {isLayoutNode ? (
        <Component {...props} />
      ) : (
        <Box
          sx={{
            display: 'flex',
            alignItems: boundLayoutProps.verticalAlign,
            justifyContent: boundLayoutProps.horizontalAlign,
          }}
        >
          <Component {...props} />
        </Box>
      )}
    </NodeRuntimeWrapper>
  );
}

interface PageRootProps {
  children?: React.ReactNode;
}

function PageRoot({ children }: PageRootProps) {
  return (
    <Container>
      <Stack
        data-testid="page-root"
        direction="column"
        sx={{
          my: 2,
          gap: 1,
        }}
      >
        {children}
      </Stack>
    </Container>
  );
}

const PageRootComponent = createComponent(PageRoot, {
  argTypes: {
    children: {
      typeDef: { type: 'element' },
      control: { type: 'slots' },
    },
  },
});

/**
 * Turns an object consisting of a nested structure of BindableAttrValues
 * into a flat array of relative paths associated with their value.
 * Example:
 *   { foo: { bar: { type: 'const', value:1 } }, baz: [{ type: 'jsExpression', value: 'quux' }] }
 *   =>
 *   [['.foo.bar', { type: 'const', value:1 }],
 *    ['.baz[0]', { type: 'jsExpression', value: 'quux' }]]
 */
function flattenNestedBindables(
  params?: NestedBindableAttrs,
  prefix = '',
): [string, BindableAttrValue<any>][] {
  if (!params) {
    return [];
  }
  if (Array.isArray(params)) {
    return params.flatMap((param, i) => {
      return flattenNestedBindables(param[1], `${prefix}[${i}][1]`);
    });
  }
  // TODO: create a marker in bindables (similar to $$ref) to recognize them automatically
  // in a nested structure. This would allow us to build deeply nested structures
  if (typeof params.type === 'string') {
    return [[prefix, params as BindableAttrValue<any>]];
  }
  return Object.entries(params).flatMap(([key, param]) =>
    flattenNestedBindables(param, `${prefix}.${key}`),
  );
}

function resolveBindables(
  bindings: Partial<Record<string, BindingEvaluationResult>>,
  bindingId: string,
  params?: NestedBindableAttrs,
): Record<string, unknown> {
  const result: any = {};
  const resultKey = 'value';
  const flattened = flattenNestedBindables(params);
  for (const [path] of flattened) {
    const resolvedValue = bindings[`${bindingId}${path}`]?.value;
    _.set(result, `${resultKey}${path}`, resolvedValue);
  }

  return result[resultKey] || {};
}

interface QueryNodeProps {
  node: appDom.QueryNode;
}

function QueryNode({ node }: QueryNodeProps) {
  const bindings = useBindingsContext();
  const setControlledBinding = useSetControlledBindingContext();

  const params = resolveBindables(
    bindings,
    `${node.id}.params`,
    Object.fromEntries(node.params ?? []),
  );

  const configBindings = _.pick(node.attributes, USE_DATA_QUERY_CONFIG_KEYS);
  const options = resolveBindables(bindings, `${node.id}.config`, configBindings);
  const queryResult = useDataQuery(node, params, options);

  React.useEffect(() => {
    const { isLoading, error, data, rows, ...result } = queryResult;

    for (const [key, value] of Object.entries(result)) {
      const bindingId = `${node.id}.${key}`;
      setControlledBinding(bindingId, { value });
    }

    // Here we propagate the error and loading state to the data and rows prop prop
    // TODO: is there a straightforward way for us to generalize this behavior?
    setControlledBinding(`${node.id}.isLoading`, { value: isLoading });
    setControlledBinding(`${node.id}.error`, { value: error });
    const deferredStatus = { loading: isLoading, error };
    setControlledBinding(`${node.id}.data`, { ...deferredStatus, value: data });
    setControlledBinding(`${node.id}.rows`, { ...deferredStatus, value: rows });
  }, [node.id, queryResult, setControlledBinding]);

  return null;
}

interface MutationNodeProps {
  node: appDom.QueryNode;
}

function MutationNode({ node }: MutationNodeProps) {
  const { appId, version } = useAppContext();
  const bindings = useBindingsContext();
  const setControlledBinding = useSetControlledBindingContext();

  const queryId = node.id;
  const params = resolveBindables(bindings, `${node.id}.params`, node.params);

  const {
    isLoading,
    data: responseData = EMPTY_OBJECT,
    error: fetchError,
    mutateAsync,
  } = useMutation(
    async (overrides: any = {}) =>
      execDataSourceQuery({
        appId,
        version,
        queryId,
        params: { ...params, ...overrides },
      }),
    {
      mutationKey: [appId, version, queryId, params],
    },
  );

  const { data, error: apiError } = responseData;

  const error = apiError || fetchError;

  // Stabilize the mutation and prepare for inclusion in global scope
  const mutationResult: UseFetch = React.useMemo(
    () => ({
      isLoading,
      isFetching: isLoading,
      error,
      data,
      rows: Array.isArray(data) ? data : EMPTY_ARRAY,
      call: mutateAsync,
      fetch: mutateAsync,
      refetch: () => {
        throw new Error(`refetch is not supported in manual queries`);
      },
    }),
    [isLoading, error, mutateAsync, data],
  );

  React.useEffect(() => {
    for (const [key, value] of Object.entries(mutationResult)) {
      const bindingId = `${node.id}.${key}`;
      setControlledBinding(bindingId, { value });
    }
  }, [node.id, mutationResult, setControlledBinding]);

  return null;
}

interface FetchNodeProps {
  node: appDom.QueryNode;
}

function FetchNode({ node }: FetchNodeProps) {
  const mode: appDom.FetchMode = node.attributes.mode?.value || 'query';
  switch (mode) {
    case 'query':
      return <QueryNode node={node} />;
    case 'mutation':
      return <MutationNode node={node} />;
    default:
      throw new Error(`Unrecognized fetch mdoe "${mode}"`);
  }
}

interface ParseBindingOptions {
  scopePath?: string;
}

function parseBinding(bindable: BindableAttrValue<any>, { scopePath }: ParseBindingOptions = {}) {
  if (bindable?.type === 'const') {
    return {
      scopePath,
      result: { value: bindable.value },
    };
  }
  if (bindable?.type === 'jsExpression') {
    return {
      scopePath,
      expression: bindable.value,
    };
  }
  return {
    scopePath,
    result: { value: undefined },
  };
}

function parseBindings(
  dom: appDom.AppDom,
  page: appDom.PageNode,
  components: ToolpadComponents,
  location: RouterLocation,
) {
  const elements = appDom.getDescendants(dom, page);

  const parsedBindingsMap = new Map<string, ParsedBinding>();
  const controlled = new Set<string>();

  for (const elm of elements) {
    if (appDom.isElement<any>(elm)) {
      const componentId = getComponentId(elm);
      const Component = components[componentId];

      const { argTypes = {} } = Component?.[TOOLPAD_COMPONENT] ?? {};

      for (const [propName, argType] of Object.entries(argTypes)) {
        const initializerId = argType?.defaultValueProp
          ? `${elm.id}.props.${argType.defaultValueProp}`
          : undefined;

        const binding: BindableAttrValue<any> =
          elm.props?.[propName] || appDom.createConst(argType?.defaultValue ?? undefined);

        const bindingId = `${elm.id}.props.${propName}`;
        const scopePath =
          componentId === PAGE_ROW_COMPONENT_ID ? undefined : `${elm.name}.${propName}`;
        if (argType) {
          if (argType.onChangeProp) {
            controlled.add(bindingId);
            parsedBindingsMap.set(bindingId, {
              scopePath,
              initializer: initializerId,
            });
          } else {
            parsedBindingsMap.set(bindingId, parseBinding(binding, { scopePath }));
          }
        }
      }

      if (!isPageLayoutComponent(elm)) {
        for (const [propName, argType] of Object.entries(layoutBoxArgTypes)) {
          const binding =
            elm.layout?.[propName as keyof typeof layoutBoxArgTypes] ||
            appDom.createConst(argType?.defaultValue ?? undefined);
          const bindingId = `${elm.id}.layout.${propName}`;
          parsedBindingsMap.set(bindingId, parseBinding(binding, {}));
        }
      }
    }

    if (appDom.isQuery(elm)) {
      if (elm.params) {
        const nestedBindablePaths = flattenNestedBindables(Object.fromEntries(elm.params ?? []));

        for (const [nestedPath, paramValue] of nestedBindablePaths) {
          const bindingId = `${elm.id}.params${nestedPath}`;
          const scopePath = `${elm.name}.params${nestedPath}`;
          const bindable = paramValue || appDom.createConst(undefined);
          parsedBindingsMap.set(bindingId, parseBinding(bindable, { scopePath }));
        }
      }

      for (const [key, value] of Object.entries(INITIAL_FETCH)) {
        const bindingId = `${elm.id}.${key}`;
        const scopePath = `${elm.name}.${key}`;
        controlled.add(bindingId);
        parsedBindingsMap.set(bindingId, {
          scopePath,
          result: { value, loading: true },
        });
      }

      const configBindings = _.pick(elm.attributes, USE_DATA_QUERY_CONFIG_KEYS);
      const nestedBindablePaths = flattenNestedBindables(configBindings);

      for (const [nestedPath, paramValue] of nestedBindablePaths) {
        const bindingId = `${elm.id}.config${nestedPath}`;
        const scopePath = `${elm.name}.config${nestedPath}`;
        const bindable = paramValue || appDom.createConst(undefined);
        parsedBindingsMap.set(bindingId, parseBinding(bindable, { scopePath }));
      }
    }

    if (appDom.isMutation(elm)) {
      if (elm.params) {
        for (const [paramName, bindable] of Object.entries(elm.params)) {
          const bindingId = `${elm.id}.params.${paramName}`;
          const scopePath = `${elm.name}.params.${paramName}`;
          if (bindable?.type === 'const') {
            parsedBindingsMap.set(bindingId, {
              scopePath,
              result: { value: bindable.value },
            });
          } else if (bindable?.type === 'jsExpression') {
            parsedBindingsMap.set(bindingId, {
              scopePath,
              expression: bindable.value,
            });
          }
        }
      }

      for (const [key, value] of Object.entries(INITIAL_FETCH)) {
        const bindingId = `${elm.id}.${key}`;
        const scopePath = `${elm.name}.${key}`;
        controlled.add(bindingId);
        parsedBindingsMap.set(bindingId, {
          scopePath,
          result: { value, loading: true },
        });
      }
    }
  }

  const urlParams = new URLSearchParams(location.search);
  const pageParameters = page.attributes.parameters?.value || [];
  for (const [paramName, paramDefault] of pageParameters) {
    const bindingId = `${page.id}.parameters.${paramName}`;
    const scopePath = `page.parameters.${paramName}`;
    parsedBindingsMap.set(bindingId, {
      scopePath,
      result: { value: urlParams.get(paramName) || paramDefault },
    });
  }

  const parsedBindings: Record<string, ParsedBinding> = Object.fromEntries(parsedBindingsMap);

  return { parsedBindings, controlled };
}

function RenderedPage({ nodeId }: RenderedNodeProps) {
  const dom = useDomContext();
  const page = appDom.getNode(dom, nodeId, 'page');
  const { children = [], queries = [] } = appDom.getChildNodes(dom, page);

  usePageTitle(page.attributes.title.value);

  const location = useLocation();
  const components = useComponents();

  const { parsedBindings, controlled } = React.useMemo(
    () => parseBindings(dom, page, components, location),
    [components, dom, location, page],
  );

  const [pageBindings, setPageBindings] =
    React.useState<Record<string, ParsedBinding>>(parsedBindings);

  const prevDom = React.useRef(dom);
  React.useEffect(() => {
    if (dom === prevDom.current) {
      // Ignore this effect if there are no dom updates.
      // IMPORTANT!!! This assumes the `RenderedPage` component is remounted when the `nodeId` changes
      //  <RenderedPage nodeId={someId} key={someId} />
      return;
    }
    prevDom.current = dom;

    setPageBindings((existingBindings) => {
      // Make sure to patch page bindings after dom nodes have been added or removed
      const updated: Record<string, ParsedBinding> = {};
      for (const [key, binding] of Object.entries(parsedBindings)) {
        updated[key] = controlled.has(key) ? existingBindings[key] || binding : binding;
      }
      return updated;
    });
  }, [parsedBindings, controlled, dom]);

  const setControlledBinding = React.useCallback(
    (id: string, result: BindingEvaluationResult) => {
      const parsedBinding = parsedBindings[id];
      setPageBindings((existing) => {
        if (!controlled.has(id)) {
          throw new Error(`Not a controlled binding "${id}"`);
        }
        return {
          ...existing,
          [id]: { ...parsedBinding, result },
        };
      });
    },
    [parsedBindings, controlled],
  );

  const modules = useAppModules();
  const moduleEntry = modules[`pages/${nodeId}`];
  const globalScope = (moduleEntry?.module as any)?.globalScope || EMPTY_OBJECT;

  const evaluatedBindings = React.useMemo(
    () => evalJsBindings(pageBindings, globalScope),
    [globalScope, pageBindings],
  );

  const pageState = React.useMemo(
    () => buildGlobalScope(globalScope, evaluatedBindings),
    [evaluatedBindings, globalScope],
  );
  const liveBindings: Record<string, BindingEvaluationResult> = React.useMemo(
    () => mapValues(evaluatedBindings, (binding) => binding.result || { value: undefined }),
    [evaluatedBindings],
  );

  const evaluatePageExpression = React.useCallback(
    (expression: string) => evaluateExpression(expression, pageState),
    [pageState],
  );

  React.useEffect(() => {
    fireEvent({ type: 'pageStateUpdated', pageState });
  }, [pageState]);

  React.useEffect(() => {
    fireEvent({ type: 'pageBindingsUpdated', bindings: liveBindings });
  }, [liveBindings]);

  return (
    <BindingsContextProvider value={liveBindings}>
      <SetControlledBindingContextProvider value={setControlledBinding}>
        <EvaluatePageExpressionProvider value={evaluatePageExpression}>
          <RenderedNodeContent
            node={page}
            childNodeGroups={{ children }}
            Component={PageRootComponent}
          />

          {queries.map((node) => (
            <FetchNode key={node.id} node={node} />
          ))}
        </EvaluatePageExpressionProvider>
      </SetControlledBindingContextProvider>
    </BindingsContextProvider>
  );
}

interface RenderedPagesProps {
  dom: appDom.AppDom;
  version: VersionOrPreview;
}

function RenderedPages({ dom, version }: RenderedPagesProps) {
  const root = appDom.getApp(dom);
  const { pages = [] } = appDom.getChildNodes(dom, root);

  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate replace to={pages.length > 0 ? `/pages/${pages[0].id}` : '/pages'} />}
      />
      <Route path="/pages" element={<AppOverview dom={dom} version={version} />}>
        {pages.map((page) => (
          <Route
            key={page.id}
            index
            path={`/pages/${page.id}`}
            element={
              <RenderedPage
                nodeId={page.id}
                // Make sure the page itself mounts when the route changes. This make sure all pageBindings are reinitialized
                // during first render. Fixes https://github.com/mui/mui-toolpad/issues/1050
                key={page.id}
              />
            }
          />
        ))}
      </Route>
    </Routes>
  );
}

const FullPageCentered = styled('div')({
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

function AppLoading() {
  return <LinearProgress />;
}

function AppError({ error }: FallbackProps) {
  return (
    <FullPageCentered>
      <Alert severity="error">
        <AlertTitle>Something went wrong</AlertTitle>
        <Pre>{error.stack}</Pre>
      </Alert>
    </FullPageCentered>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 60 * 1000,
    },
  },
});

export interface ToolpadAppProps {
  rootRef?: React.Ref<HTMLDivElement>;
  basename: string;
  version: VersionOrPreview;
  state: RuntimeState;
}

export default function ToolpadApp({ rootRef, basename, version, state }: ToolpadAppProps) {
  const { appId, dom } = state;
  const appContext = React.useMemo(() => ({ appId, version }), [appId, version]);

  const [resetNodeErrorsKey, setResetNodeErrorsKey] = React.useState(0);

  React.useEffect(() => setResetNodeErrorsKey((key) => key + 1), [dom]);

  const { value: showDevtools, toggle: toggleDevtools } = useBoolean(false);

  React.useEffect(() => {
    (window as any).toggleDevtools = () => toggleDevtools();
  }, [toggleDevtools]);

  return (
    <AppRoot ref={rootRef}>
      <NoSsr>
        <DomContextProvider value={dom}>
          <AppThemeProvider dom={dom}>
            <CssBaseline enableColorScheme />
            <ErrorBoundary FallbackComponent={AppError}>
              <ResetNodeErrorsKeyProvider value={resetNodeErrorsKey}>
                <React.Suspense fallback={<AppLoading />}>
                  <AppModulesProvider modules={state.modules}>
                    <ComponentsContext dom={dom}>
                      <AppContextProvider value={appContext}>
                        <QueryClientProvider client={queryClient}>
                          <BrowserRouter basename={basename}>
                            <RenderedPages dom={dom} version={version} />
                          </BrowserRouter>
                          {showDevtools ? (
                            <ReactQueryDevtoolsProduction initialIsOpen={false} />
                          ) : null}
                        </QueryClientProvider>
                      </AppContextProvider>
                    </ComponentsContext>
                  </AppModulesProvider>
                </React.Suspense>
              </ResetNodeErrorsKeyProvider>
            </ErrorBoundary>
          </AppThemeProvider>
        </DomContextProvider>
      </NoSsr>
      <EditorOverlay id={HTML_ID_EDITOR_OVERLAY} />
    </AppRoot>
  );
}
