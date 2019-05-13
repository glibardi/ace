/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define(function(require, exports, module) {
"use strict";

var dom = require("../lib/dom");
var event = require("../lib/event");
var useragent = require("../lib/useragent");
var DefaultHandlers = require("./default_handlers").DefaultHandlers;
var DefaultGutterHandler = require("./default_gutter_handler").GutterHandler;
var MouseEvent = require("./mouse_event").MouseEvent;
var DragdropHandler = require("./dragdrop_handler").DragdropHandler;
var config = require("../config");

var MouseHandler = function(editor) {
    var _self = this;
    this.editor = editor;

    new DefaultHandlers(this);
    new DefaultGutterHandler(this);
    new DragdropHandler(this);

    var focusEditor = function(e) {
        // because we have to call event.preventDefault() any window on ie and iframes
        // on other browsers do not get focus, so we have to call window.focus() here
        var windowBlurred = !document.hasFocus || !document.hasFocus()
            || !editor.isFocused() && document.activeElement == (editor.textInput && editor.textInput.getElement());
        if (windowBlurred)
            window.focus();
        editor.focus();
    };

    var mouseTarget = editor.renderer.getMouseEventTarget();
    event.addListener(mouseTarget, "click", this.onMouseEvent.bind(this, "click"));
    event.addListener(mouseTarget, "mousemove", this.onMouseMove.bind(this, "mousemove"));
    event.addMultiMouseDownListener([
        mouseTarget,
        editor.renderer.scrollBarV && editor.renderer.scrollBarV.inner,
        editor.renderer.scrollBarH && editor.renderer.scrollBarH.inner,
        editor.textInput && editor.textInput.getElement()
    ].filter(Boolean), [400, 300, 250], this, "onMouseEvent");
    event.addMouseWheelListener(editor.container, this.onMouseWheel.bind(this, "mousewheel"));
    this.addTouchListeners(editor.container);

    var gutterEl = editor.renderer.$gutter;
    event.addListener(gutterEl, "mousedown", this.onMouseEvent.bind(this, "guttermousedown"));
    event.addListener(gutterEl, "click", this.onMouseEvent.bind(this, "gutterclick"));
    event.addListener(gutterEl, "dblclick", this.onMouseEvent.bind(this, "gutterdblclick"));
    event.addListener(gutterEl, "mousemove", this.onMouseEvent.bind(this, "guttermousemove"));

    event.addListener(mouseTarget, "mousedown", focusEditor);
    event.addListener(gutterEl, "mousedown", focusEditor);
    if (useragent.isIE && editor.renderer.scrollBarV) {
        event.addListener(editor.renderer.scrollBarV.element, "mousedown", focusEditor);
        event.addListener(editor.renderer.scrollBarH.element, "mousedown", focusEditor);
    }

    editor.on("mousemove", function(e){
        if (_self.state || _self.$dragDelay || !_self.$dragEnabled)
            return;

        var character = editor.renderer.screenToTextCoordinates(e.x, e.y);
        var range = editor.session.selection.getRange();
        var renderer = editor.renderer;

        if (!range.isEmpty() && range.insideStart(character.row, character.column)) {
            renderer.setCursorStyle("default");
        } else {
            renderer.setCursorStyle("");
        }
    });
};

(function() {
    this.onMouseEvent = function(name, e) {
        this.editor._emit(name, new MouseEvent(e, this.editor));
    };

    this.onMouseMove = function(name, e) {
        // optimization, because mousemove doesn't have a default handler.
        var listeners = this.editor._eventRegistry && this.editor._eventRegistry.mousemove;
        if (!listeners || !listeners.length)
            return;

        this.editor._emit(name, new MouseEvent(e, this.editor));
    };

    this.onMouseWheel = function(name, e) {
        var mouseEvent = new MouseEvent(e, this.editor);
        mouseEvent.speed = this.$scrollSpeed * 2;
        mouseEvent.wheelX = e.wheelX;
        mouseEvent.wheelY = e.wheelY;

        this.editor._emit(name, mouseEvent);
    };
    
    this.onTouchMove = function (name, e) {
        var mouseEvent = new MouseEvent(e, this.editor);
        mouseEvent.speed = 1;//this.$scrollSpeed * 2;
        mouseEvent.wheelX = e.wheelX;
        mouseEvent.wheelY = e.wheelY;
        this.editor._emit(name, mouseEvent);
    };
    
    this.addTouchListeners = function(el) {
        var editor = this.editor;
        var mode = "scroll";
        var startX;
        var startY;
        var touchStartT;
        var lastT;
        var longTouchTimer;
        var animationTimer;
        var animationSteps = 0;
        var pos;
        var clickCount = 0;
        var vX = 0;
        var vY = 0;
        var contextMenu;
        var pressed;
        function showContextMenu() {
            hideContextMenu();
            if (mode == "scroll")
                return;
            contextMenu = dom.buildDom(["div", 
                {
                    class: "ace_mobile-menu",
                    style: "position:absolute;background:white;color:black",
                    onclick: function(e) {
                        var action = e.target.getAttribute("action");
                        if (action) {
                            editor.execCommand(action);
                        }
                        hideContextMenu();
                        editor.focus();
                    }
                },
                ["span", {class: "ace_mobile-button", action: "copy"}, "Copy"],
                ["span", {class: "ace_mobile-button", action: "cut"}, "Cut"],
                ["span", {class: "ace_mobile-button", action: "paste"}, "Paste"],
                ["span", {class: "ace_mobile-button", action: "undo"}, "Undo"],
                ["span", {class: "ace_mobile-button", action: "openCommandPallete"}, "Pallete"],
                ["span", {class: "ace_mobile-button", action: "more"}, "..."] 
            ], document.body);
            
            var cursor = editor.selection.cursor;
            var pagePos = editor.renderer.textToScreenCoordinates(cursor.row, cursor.column);
            var h = editor.renderer.layerConfig.lineHeight;
            contextMenu.style.top = pagePos.pageY + h + "px";
            contextMenu.style.left = pagePos.pageX + "px";
            
            editor.once("beforeEndOperation", hideContextMenu);
            // editor.once("blur", hideContextMenu);
        }
        function hideContextMenu() {
            if (contextMenu) contextMenu.remove();
            contextMenu = null;
            editor.off("input", hideContextMenu);
        }
        function handleLongTap() {
            longTouchTimer = null;
            clearTimeout(longTouchTimer);
            if (editor.selection.isEmpty())
                editor.selection.moveToPosition(pos);
            mode = "wait";
        }
        function switchToSelectionMode() {
            longTouchTimer = null;
            clearTimeout(longTouchTimer);
            editor.selection.moveToPosition(pos);
            var range = clickCount >= 2
                ? editor.selection.getLineRange(pos.row)
                : editor.session.getBracketRange(pos);
            if (range && !range.isEmpty()) {
                editor.selection.setRange(range);
            } else {
                editor.selection.selectWord();
            }
            mode = "wait";
        }
        el.addEventListener("contextmenu", function(e) {
            if (!pressed) return;
            // e.preventDefault();
            // clearTimeout(longTouchTimer);
            // longTouchTimer = null;
            // var textarea = editor.textInput.getElement();
            // var wasReadonly = textarea.readOnly;
            // if (!wasReadonly)
            //     textarea.readOnly = true;
            // editor.textInput.focus();
            // if (!wasReadonly)
            //     textarea.readOnly = false;
            // showContextMenu();
            
            var textarea = editor.textInput.getElement();
            textarea.focus();
        });
        el.addEventListener("touchstart", function (e) {
            var touches = e.touches;
            if (longTouchTimer || touches.length > 1) {
                clearTimeout(longTouchTimer);
                longTouchTimer = null;
                mode = "zoom";
                return;
            }
            
            pressed = true;
            var touchObj = touches[0];
            startX = touchObj.clientX;
            startY = touchObj.clientY;
            vX = vY = 0;

            e.clientX = touchObj.clientX;
            e.clientY = touchObj.clientY;

            var t = e.timeStamp;
            lastT = t;
            
            var ev = new MouseEvent(e, editor);
            pos = ev.getDocumentPosition();

            if (t - touchStartT < 500 && touches.length == 1) {
                clickCount++;
                e.preventDefault();
                e.button = 0;
                switchToSelectionMode();
            } else {
                clickCount = 0;
                longTouchTimer = setTimeout(handleLongTap, 450);
                var cursor = editor.selection.cursor;
                var anchor = editor.selection.isEmpty() ? cursor : editor.selection.anchor;
                
                var cursorPos = editor.renderer.$cursorLayer.getPixelPosition(cursor, true);
                var anchorPos = editor.renderer.$cursorLayer.getPixelPosition(anchor, true);
                var rect = editor.renderer.scroller.getBoundingClientRect();
                var h = editor.renderer.layerConfig.lineHeight;
                var w = editor.renderer.layerConfig.lineHeight;
                var weightedDistance = function(x, y) {
                    x = x / w;
                    y = y / h - 0.75;
                    return x * x + y * y;
                };
                
                var diff1 = weightedDistance(
                    e.clientX - rect.left - cursorPos.left,
                    e.clientY - rect.top - cursorPos.top
                );
                var diff2 = weightedDistance(
                    e.clientX - rect.left - anchorPos.left,
                    e.clientY - rect.top - anchorPos.top
                );
                if (diff1 < 3.5 && diff2 < 3.5)
                    mode = diff1 > diff2 ? "cursor" : "anchor";
                    
                if (diff2 < 3.5)
                    mode = "anchor";
                else if (diff1 < 3.5)
                    mode = "cursor";
                else
                    mode = "scroll";
            }
            touchStartT = t;
            if (mode != "scroll" && contextMenu) {
                contextMenu.remove();
                contextMenu = null;
            }
        });
        
        el.addEventListener("touchend", function (e) {
            pressed = false;
            if (animationTimer) clearInterval(animationTimer);
            if (mode == "zoom") {
                mode = "";
                animationSteps = 0;
            } else if (longTouchTimer) {
                editor.selection.moveToPosition(pos);
                animationSteps = 0;
            } else if (mode == "scroll") {
                animate();
                e.preventDefault();
            }
            clearTimeout(longTouchTimer);
            longTouchTimer = null;
            // showContextMenu();
        });
        el.addEventListener("touchmove", function (e) {
            if (longTouchTimer) {
                clearTimeout(longTouchTimer);
                longTouchTimer = null;
            }
            var touches = e.touches;
            if (touches.length > 1 || mode == "zoom") return;

            var touchObj = touches[0];

            var wheelX = startX - touchObj.clientX;
            var wheelY = startY - touchObj.clientY;

            if (mode == "wait") {
                if (wheelX * wheelX + wheelY * wheelY > 4)
                    mode = "cursor";
                else
                    return e.preventDefault();
            }
            
            startX = touchObj.clientX;
            startY = touchObj.clientY;

            e.clientX = touchObj.clientX;
            e.clientY = touchObj.clientY;

            var t = e.timeStamp;
            var dt = t - lastT;
            lastT = t;
            if (mode == "scroll") {
                var mouseEvent = new MouseEvent(e, this.editor);
                mouseEvent.speed = 1;
                mouseEvent.wheelX = wheelX;
                mouseEvent.wheelY = wheelY;
                if (10 * Math.abs(wheelX) < Math.abs(wheelY)) wheelX = 0;
                if (10 * Math.abs(wheelY) < Math.abs(wheelX)) wheelY = 0;
                if (dt != 0) {
                    vX = wheelX / dt;
                    vY = wheelY / dt;
                }
                editor._emit("mousewheel", mouseEvent);
                if (!mouseEvent.propagationStopped) {
                    vX = vY = 0;
                }
                console.log(vX, vY);
            }
            else {
                var ev = new MouseEvent(e, editor);
                var pos = ev.getDocumentPosition();
                if (mode == "cursor")
                    editor.selection.moveCursorToPosition(pos);
                else if (mode == "anchor")
                    editor.selection.setSelectionAnchor(pos.row, pos.column);
                editor.renderer.scrollCursorIntoView(pos);
                e.preventDefault();
            }
        });
        
        
        function animate() {
            animationSteps += 60;
            animationTimer = setInterval(function() {
                if (animationSteps-- <= 0) {
                    clearInterval(animationTimer);
                    animationTimer = null;
                }
                if (Math.abs(vX) < 0.01) vX = 0;
                if (Math.abs(vY) < 0.01) vY = 0;
                if (animationSteps < 20) vX = 0.9 * vX;
                if (animationSteps < 20) vY = 0.9 * vY;
                editor.renderer.scrollBy(10 * vX, 10 * vY);
            }, 10);
        }
    };

    this.setState = function(state) {
        this.state = state;
    };

    this.captureMouse = function(ev, mouseMoveHandler) {
        this.x = ev.x;
        this.y = ev.y;

        this.isMousePressed = true;

        // do not move textarea during selection
        var editor = this.editor;
        var renderer = this.editor.renderer;
        if (renderer.$keepTextAreaAtCursor)
            renderer.$keepTextAreaAtCursor = null;

        var self = this;
        var onMouseMove = function(e) {
            if (!e) return;
            // if editor is loaded inside iframe, and mouseup event is outside
            // we won't recieve it, so we cancel on first mousemove without button
            if (useragent.isWebKit && !e.which && self.releaseMouse)
                return self.releaseMouse();
            
            if (e.clientX == undefined && e.touches && e.touches[0])
                e = e.touches[0];
            
            self.x = e.clientX;
            self.y = e.clientY;
            
            mouseMoveHandler && mouseMoveHandler(e);
            self.mouseEvent = new MouseEvent(e, self.editor);
            self.$mouseMoved = true;
        };

        var onCaptureEnd = function(e) {
            editor.off("beforeEndOperation", onOperationEnd);
            clearInterval(timerId);
            onCaptureInterval();
            self[self.state + "End"] && self[self.state + "End"](e);
            self.state = "";
            if (renderer.$keepTextAreaAtCursor == null) {
                renderer.$keepTextAreaAtCursor = true;
                renderer.$moveTextAreaToCursor();
            }
            self.isMousePressed = false;
            self.$onCaptureMouseMove = self.releaseMouse = null;
            e && self.onMouseEvent("mouseup", e);
            editor.endOperation();
        };

        var onCaptureInterval = function() {
            self[self.state] && self[self.state]();
            self.$mouseMoved = false;
        };

        if (useragent.isOldIE && ev.domEvent.type == "dblclick") {
            return setTimeout(function() {onCaptureEnd(ev);});
        }

        var onOperationEnd = function(e) {
            if (!self.releaseMouse) return;
            // some touchpads fire mouseup event after a slight delay, 
            // which can cause problems if user presses a keyboard shortcut quickly
            if (editor.curOp.command.name && editor.curOp.selectionChanged) {
                self[self.state + "End"] && self[self.state + "End"]();
                self.state = "";
                self.releaseMouse();
            }
        };

        editor.on("beforeEndOperation", onOperationEnd);
        editor.startOperation({command: {name: "mouse"}});

        self.$onCaptureMouseMove = onMouseMove;
        self.releaseMouse = event.capture(this.editor.container, onMouseMove, onCaptureEnd);
        var timerId = setInterval(onCaptureInterval, 20);
    };
    this.releaseMouse = null;
    this.cancelContextMenu = function() {
        var stop = function(e) {
            if (e && e.domEvent && e.domEvent.type != "contextmenu")
                return;
            this.editor.off("nativecontextmenu", stop);
            if (e && e.domEvent)
                event.stopEvent(e.domEvent);
        }.bind(this);
        setTimeout(stop, 10);
        this.editor.on("nativecontextmenu", stop);
    };
}).call(MouseHandler.prototype);

config.defineOptions(MouseHandler.prototype, "mouseHandler", {
    scrollSpeed: {initialValue: 2},
    dragDelay: {initialValue: (useragent.isMac ? 150 : 0)},
    dragEnabled: {initialValue: true},
    focusTimeout: {initialValue: 0},
    tooltipFollowsMouse: {initialValue: true}
});


exports.MouseHandler = MouseHandler;
});
