define([
    './core/DOMTransform',
    './core/ModelValue',
    './core/Promise',
    './model'
], function(
    DOMTransform,
    ModelValue,
    CurvilinearPromise,
    model
) {
    function CancellationError() {
        this.name = 'CancellationError';
        this.message = ' ';
    }

    CancellationError.prototype = Object.create(Error.prototype);
    CancellationError.prototype.constructor = CancellationError;

    var crossbrowserMatches = Element.prototype.matches || Element.prototype.mozMatchesSelector || Element.prototype.webkitMatchesSelector || Element.prototype.msMatchesSelector;

    function Controller(el) {
        var typeofEl = typeof el;

        if (typeofEl !== 'string' && (typeofEl !== 'object' || el === null)) {
            throw new TypeError('Controller constructor only accepts non-null el of type "string" or "object"');
        }

        this.el = typeofEl === 'string' ? document.querySelector(el) : el;

        if (this.el === null) {
            throw new Error('Could not find element for selector "' + el + '"');
        }

        var events = this.events,
            self = this;

        if (events) {
            var eventHandlersForType = this.eventHandlersForType = {};

            Object.keys(events).forEach(function(k) {
                var i = k.indexOf(' '),
                    type = k.substring(0, i);

                function mainHandler(event) {
                    event.stopPropagation();

                    eventHandlersForType[type].forEach(function(handler) {
                        if (crossbrowserMatches.call(event.target || event.srcElement, handler.selector)) {
                            handler.handler.call(self, event);
                        }
                    });
                }

                if (!eventHandlersForType[type]) {
                    eventHandlersForType[type] = [];

                    self.el.addEventListener(type, mainHandler);

                    self.own(function() {
                        self.el.removeEventListener(type, mainHandler);
                    });
                }

                eventHandlersForType[type].push({

                    selector: k.substring(i + 1, k.length),

                    handler: events[k].bind(self)

                });
            });
        }

        this._changeListenerDestroyFunctions = [];
        this._children = [];
        this._data = Object.freeze({});
    }

    Controller.prototype = {

        render: function() {
            if (this._destroyed) {
                throw new Error('Cannot call `render` on a destroyed Controller');
            }

            var datasources = this.datasources;

            if (datasources === null || typeof datasources === 'undefined') {
                throw new Error('Controller.datasources must be an Object or an Array of Object');
            }

            datasources = (datasources instanceof Array && datasources) || [datasources];

            var self = this,
                pending = [],
                newData = {};

            if (self._pending) {
                self._pending.cancelled = true;
            }

            self._pending = pending;

            self._changeListenerDestroyFunctions.forEach(function(destroy) {
                destroy();

                self.disown(destroy);
            });

            var changeListenerDestroyFunctions = self._changeListenerDestroyFunctions = [];

            datasources.forEach(function(source) {
                pending.push(function() {
                    var sourceKeys = Object.keys(source),
                        promises = new Array(sourceKeys.length);

                    sourceKeys.forEach(function(sourceKey, i) {
                        var sourceValue = source[sourceKey].call(self, newData);

                        if (typeof sourceValue.then === 'function') {
                            promises[i] = sourceValue;
                        } else {
                            var sourcePromise = new CurvilinearPromise();

                            promises[i] = sourcePromise;

                            sourcePromise.fulfill(sourceValue);
                        }
                    });

                    return CurvilinearPromise.parallelize(promises).then(function(results) {
                        if (!pending.cancelled) {
                            results.forEach(function(result, i) {
                                var modelKey = result instanceof ModelValue && result.key;

                                if (typeof modelKey === 'string') {
                                    changeListenerDestroyFunctions.push(model.observe(modelKey, self.render.bind(self)));

                                    result = result.value;
                                }

                                newData[sourceKeys[i]] = result;
                            });
                        }
                    });
                });
            });

            var mainPromise = new CurvilinearPromise();

            CurvilinearPromise.serialize(pending).then(function() {
                if (!pending.cancelled) {
                    self._data = Object.freeze(newData);
                    self._pending = null;
                    self._destroyChildren();

                    var closingTag = '</' + self.el.tagName.toLowerCase() + '>';

                    self._transform(self.el, self.el.outerHTML.replace(self.el.innerHTML + closingTag, self.generateHTML(self._data) + closingTag));

                    var children = self._createChildren(self._data);

                    if (children) {
                        if (!(children instanceof Array)) {
                            children = [children];
                        }

                        children.forEach(function(child) {
                            child.render();

                            self._children.push(child);
                        });
                    }

                    mainPromise.fulfill();
                } else {
                    mainPromise.reject(new CancellationError());
                }
            });

            return mainPromise;
        },

        generateHTML: function(data) {
            throw new Error('Controller.generateHTML must be implemented');
        },

        destroy: function() {
            if (this._destroyables) {
                this._destroyables.forEach(function(destroy) {
                    destroy();
                });
            }

            this._changeListenerDestroyFunctions.forEach(function(destroy) {
                destroy();
            });

            this._destroyChildren();

            this.el.parentNode.removeChild(this.el);

            this._destroyed = true;

            return this;
        },

        own: function(ownable) {
            if (typeof ownable !== 'function') {
                throw new TypeError('Controller.own only accepts ownable of type "function"');
            }

            this._destroyables = this._destroyables || [];

            this._destroyables.push(ownable);

            return this;
        },

        disown: function(f) {
            var destroyables = this._destroyables,
                l = destroyables.length;

            while (l--) {
                if (destroyables[l] === f) {
                    destroyables.splice(l, 1);
                }
            }

            return this;
        },

        _createChildren: function(data) {},

        _destroyChildren: function() {
            this._children.forEach(function(child) {
                child.destroy();
            });

            this._children = [];
        },

        _transform: function(el, html) {
            var newEl = document.createElement('body');

            newEl.innerHTML = html;

            DOMTransform(newEl.childNodes[0], el);
        }

    };

    return Controller;
});