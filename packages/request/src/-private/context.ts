import { DEBUG } from '@ember-data/env';

import { deepFreeze } from './debug';
import { createDeferred } from './future';
import type { Deferred, GodContext, ImmutableHeaders, ImmutableRequestInfo, RequestInfo, ResponseInfo } from './types';

export class ContextOwner {
  hasSetStream = false;
  hasSetResponse = false;
  hasSubscribers = false;
  stream: Deferred<ReadableStream | null> = createDeferred<ReadableStream | null>();
  response: ResponseInfo | null = null;
  declare request: ImmutableRequestInfo;
  declare enhancedRequest: ImmutableRequestInfo;
  nextCalled: number = 0;
  declare god: GodContext;
  declare controller: AbortController;
  declare requestId: number;

  constructor(request: RequestInfo, god: GodContext) {
    this.requestId = god.id;
    this.controller = request.controller || god.controller;
    if (request.controller) {
      if (request.controller !== god.controller) {
        god.controller.signal.addEventListener('abort', () => {
          this.controller.abort(god.controller.signal.reason);
        });
      }
      delete request.controller;
    }
    let enhancedRequest: ImmutableRequestInfo = Object.assign(
      { signal: this.controller.signal },
      request
    ) as ImmutableRequestInfo;
    if (DEBUG) {
      request = deepFreeze(request) as ImmutableRequestInfo;
      enhancedRequest = deepFreeze(enhancedRequest);
    } else {
      if (request.headers) {
        (request.headers as ImmutableHeaders).clone = () => {
          return new Headers([...request.headers!.entries()]);
        };
        (request.headers as ImmutableHeaders).toJSON = () => {
          return [...request.headers!.entries()];
        };
      }
    }
    this.enhancedRequest = enhancedRequest;
    this.request = request as ImmutableRequestInfo;
    this.god = god;
    this.stream.promise = this.stream.promise.then((stream: ReadableStream | null) => {
      if (this.god.stream === stream && this.hasSubscribers) {
        this.god.stream = null;
      }
      return stream;
    });
  }

  getResponse(): ResponseInfo | null {
    if (this.hasSetResponse) {
      return this.response;
    }
    if (this.nextCalled === 1) {
      return this.god.response;
    }
    return null;
  }
  getStream(): Promise<ReadableStream | null> {
    this.hasSubscribers = true;
    return this.stream.promise;
  }
  abort(reason: DOMException) {
    this.controller.abort(reason);
  }

  setStream(stream: ReadableStream | Promise<ReadableStream | null> | null) {
    if (!this.hasSetStream) {
      this.hasSetStream = true;

      if (!(stream instanceof Promise)) {
        this.god.stream = stream;
      }
      // @ts-expect-error
      this.stream.resolve(stream);
    }
  }

  resolveStream() {
    this.setStream(this.nextCalled === 1 ? this.god.stream : null);
  }

  setResponse(response: ResponseInfo | Response | null) {
    if (this.hasSetResponse) {
      if (DEBUG) {
        throw new Error(`Cannot setResponse when a response has already been set`);
      }
      return;
    }
    this.hasSetResponse = true;
    if (response instanceof Response) {
      const { headers, ok, redirected, status, statusText, type, url } = response;
      (headers as ImmutableHeaders).clone = () => {
        return new Headers([...headers.entries()]);
      };
      (headers as ImmutableHeaders).toJSON = () => {
        return [...headers.entries()];
      };
      let responseData: ResponseInfo = {
        headers: headers as ImmutableHeaders,
        ok,
        redirected,
        status,
        statusText,
        type,
        url,
      };
      if (DEBUG) {
        responseData = deepFreeze(responseData);
      }
      this.response = responseData;
      this.god.response = responseData;
    } else {
      this.response = response;
      this.god.response = response;
    }
  }
}

export class Context {
  #owner: ContextOwner;
  declare request: ImmutableRequestInfo;
  declare id: number;

  constructor(owner: ContextOwner) {
    this.id = owner.requestId;
    this.#owner = owner;
    this.request = owner.enhancedRequest;
  }
  setStream(stream: ReadableStream | Promise<ReadableStream | null>) {
    this.#owner.setStream(stream);
  }
  setResponse(response: ResponseInfo | Response | null) {
    this.#owner.setResponse(response);
  }
}
export type HandlerRequestContext = Context;
