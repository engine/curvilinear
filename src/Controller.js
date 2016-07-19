define([
    './core/DOMTransform',
    './core/ModelValue',
    './model'
], function(
    DOMTransform,
    ModelValue,
    model
) {
    function Controller(el) {
        var typeofEl = typeof el;

        if (typeofEl !== 'string' && (typeofEl !== 'object' || el === null)) {
            throw new TypeError('Controller constructor only accepts non-null el of type "string" or "object"');
        }

        if (typeofEl === 'string') {
            this._selector = el;
            this.el = document.querySelector(el);
        } else {
            this.el = el;
        }

        if (this.el === null) {
            throw new Error('Could not find element for selector "' + el + '"');
        }

        this._changeListenerDestructors = {};
        this._childInstances = {};
        this._eventListeners = [];
    }

    Controller.prototype = {

        _resolveDataSourceCollection: function(index, data, collection, cb) {
            var keys = Object.keys(collection),
                l = keys.length,
                i = 0,
                self = this,
                changeListenerDestructorsForIndex = this._changeListenerDestructors[index];

            if (changeListenerDestructorsForIndex) {
                changeListenerDestructorsForIndex.forEach(function(destroy) {
                    destroy();
                });
            } else {
                this._changeListenerDestructors[index] = changeListenerDestructorsForIndex = [];
            }

            function check(key, result) {
                var modelKey = result instanceof ModelValue && result.key;

                if (typeof modelKey === 'string') {
                    changeListenerDestructorsForIndex.push(model.observe(modelKey, function() {
                        self.start(index);
                    }));

                    result = result.value;
                }

                data[key] = result;

                if (++i === l) {
                    cb();
                }
            }

            keys.forEach(function(key) {
                try {
                    var result = collection[key].call(self, data);
                    if (result && typeof result.then === 'function') {
                        result.then(function(deferredResult) {
                            check(key, deferredResult);
                        }, cb);
                    } else {
                        check(key, result);
                    }
                } catch (e) {
                    cb(e);
                }
            });
        },

        _resolveDataSources: function(resolveFrom, cb) {
            var datasources = this.datasources,
                data = {},
                self = this;

            if (datasources) {
                if (datasources instanceof Array) {
                    var i = resolveFrom,
                        l = datasources.length;

                    (function iterate() {
                        self._resolveDataSourceCollection(i, data, datasources[i], function(error) {
                            if (error) {
                                if (cb) {
                                    cb(error);
                                }
                            } else if (++i < l) {
                                iterate();
                            } else {
                                self._data = Object.freeze(data);

                                if (cb) {
                                    cb();
                                }
                            }
                        });
                    }());
                } else {
                    this._resolveDataSourceCollection(null, data, datasources, function(error) {
                        if (error) {
                            cb(error);
                        } else {
                            self._data = Object.freeze(data);

                            if (cb) {
                                cb();
                            }
                        }
                    });
                }
            } else if (cb) {
                cb();
            }
        },

        _render: function() {
            var newEl = document.createElement('body'),
                closingTag = '</' + this.el.tagName.toLowerCase() + '>';

            newEl.innerHTML = this.el.outerHTML.replace(this.el.innerHTML + closingTag, this.generateHTML(this._data) + closingTag);

            return newEl;
        },

        _attachEventHandlers: function() {
            var events = this.events;

            if (events && typeof events === 'object') {
                var childInstances = this._childInstances,
                    self = this;

                self._eventListeners.forEach(function(destroy) {
                    destroy();
                });

                Object.keys(events).forEach(function(key) {
                    var j = key.indexOf(' '),
                        type = key.substring(0, j),
                        eventTargets = self.el.querySelectorAll(key.substring(j + 1, key.length));

                    if (eventTargets) {
                        var childInstancesKeys = Object.keys(childInstances),
                            l = childInstancesKeys.length,
                            handler = function(event) {
                                var isRelevantNode = true,
                                    eventTarget = event.target;

                                if (eventTarget !== this) {
                                    while (eventTarget) {
                                        if (eventTarget === self.el) {
                                            break;
                                        } else {
                                            for (var i = 0; i < childInstancesKeys.length; i++) {
                                                if (childInstances[childInstancesKeys[i]].el === eventTarget) {
                                                    isRelevantNode = false;

                                                    break;
                                                }
                                            }
                                        }

                                        eventTarget = eventTarget.parentNode;
                                    }
                                }

                                if (isRelevantNode) {
                                    event.stopPropagation();

                                    events[key].call(self, event);
                                }
                            };

                        if (l) {
                            eventTargets = Array.prototype.filter.call(eventTargets, function(node) {
                                while (node) {
                                    if (node === self.el) {
                                        return true;
                                    } else {
                                        for (var i = 0; i < l; i++) {
                                            if (childInstances[childInstancesKeys[i]].el === node) {
                                                return false;
                                            }
                                        }
                                    }

                                    node = node.parentNode;
                                }

                                return false;
                            });
                        }

                        Array.prototype.forEach.call(eventTargets, function(selected) {
                            selected.addEventListener(type, handler);

                            self._eventListeners.push(function() {
                                selected.removeEventListener(type, handler);
                            });
                        });
                    }
                });
            }
        },

        _transform: function(target, newEl, cb) {
            var childInstances = this._childInstances,
                childrenToRender = 0,
                childrenRendered = 0,
                self = this;

            DOMTransform(newEl.childNodes[0], target, childInstances);

            self.el = target;

            for (var selector in this.children) {
                var childTarget = target.querySelector(selector);

                if (childTarget) {
                    if (!childInstances[selector]) {
                        childInstances[selector] = this.children[selector].call(this, childTarget);

                        childrenToRender++;

                        childInstances[selector].start(function(error) {
                            if (error) {
                                if (cb) {
                                    cb(error);
                                }
                            } else if (++childrenRendered === childrenToRender) {
                                self._attachEventHandlers();

                                if (cb) {
                                    cb();
                                }
                            }
                        });
                    }
                } else if (childInstances[selector]) {
                    childInstances[selector].destroy();

                    delete childInstances[selector];
                }
            }

            if (!childrenToRender) {
                this._attachEventHandlers();

                if (cb) {
                    cb();
                }
            }
        },

        generateHTML: function(data) {
            throw new Error('Controller.generateHTML must be implemented');
        },

        destroy: function() {
            if (!this._destroyed) {
                if (this._destroyables) {
                    this._destroyables.forEach(function(destroy) {
                        destroy();
                    });
                }

                var key;

                for (key in this._changeListenerDestructors) {
                    this._changeListenerDestructors[key].forEach(function(destroy) {
                        destroy();
                    });
                }

                for (key in this._childInstances) {
                    this._childInstances[key].destroy();
                }

                this._eventListeners.forEach(function(destroy) {
                    destroy();
                });

                if (this.el.parentNode) {
                    this.el.parentNode.removeChild(this.el);
                }

                this._changeListenerDestructors = this._childInstances = this._eventListeners = null;

                this._destroyed = true;
            }

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

        start: function(resolveFrom, cb) {
            if (this._destroyed) {
                throw new Error('Cannot start destroyed Controller!');
            }

            if (resolveFrom && typeof resolveFrom === 'function') {
                cb = resolveFrom;
                resolveFrom = null;
            }

            var self = this;

            this._resolveDataSources(resolveFrom || 0, function(error) {
                if (error) {
                    if (cb) {
                        cb(error);
                    }
                } else {
                    try {
                        self._transform(self.el, self._render(), cb);
                    } catch (e) {
                        if (cb) {
                            cb(e);
                        }
                    }
                }
            });

            return this;
        }

    };

    return Controller;
});
