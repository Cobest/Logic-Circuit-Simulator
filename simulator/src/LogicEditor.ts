
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import LogicEditorTemplate from "../html/LogicEditorTemplate.html"

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import LogicEditorCSS from "../css/LogicEditor.css"

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import DialogPolyfillCSS from "../../node_modules/dialog-polyfill/dist/dialog-polyfill.css"

import dialogPolyfill from 'dialog-polyfill'
import { saveAs } from 'file-saver'
import JSON5 from "json5"
import * as LZString from "lz-string"
import * as pngMeta from 'png-metadata-writer'
import { ComponentFactory } from "./ComponentFactory"
import { ComponentList } from "./ComponentList"
import { ComponentMenu } from "./ComponentMenu"
import { MessageBar } from "./MessageBar"
import { MoveManager } from "./MoveManager"
import { NodeManager } from "./NodeManager"
import { RecalcManager, RedrawManager } from "./RedrawRecalcManager"
import { SVGRenderingContext } from "./SVGRenderingContext"
import { Circuit, Serialization } from "./Serialization"
import { TestCaseCombinational, TestCaseResult, TestCaseResultMismatch, TestCaseValueMap, TestSuite, TestSuiteResults, TestSuites } from "./TestSuite"
import { Tests } from "./Tests"
import { TestsPalette } from "./TestsPalette"
import { Timeline } from "./Timeline"
import { TopBar } from "./TopBar"
import { EditorSelection, PointerDragEvent, UIEventManager } from "./UIEventManager"
import { UndoManager } from './UndoManager'
import { Component, ComponentBase } from "./components/Component"
import { CustomComponent } from "./components/CustomComponent"
import { Drawable, DrawableParent, DrawableWithDraggablePosition, DrawableWithPosition, EditTools, GraphicsRendering, Orientation } from "./components/Drawable"
import { type Input } from "./components/Input"
import { Rectangle, RectangleDef } from "./components/Rectangle"
import { LinkManager, Wire, WireStyle, WireStyles } from "./components/Wire"
import { COLOR_BACKGROUND, COLOR_BACKGROUND_UNUSED_REGION, COLOR_BORDER, COLOR_COMPONENT_BORDER, COLOR_COMPONENT_ID, COLOR_GRID_LINES, COLOR_GRID_LINES_GUIDES, DrawZIndex, GRID_STEP, TextVAlign, USER_COLORS, drawAnchorsAroundComponent as drawAnchorsForComponent, fillTextVAlign, isDarkMode, parseColorToRGBA, setDarkMode, strokeSingleLine, strokeTextVAlign } from "./drawutils"
import { gallery } from './gallery'
import { Modifier, a, attr, attrBuilder, cls, div, emptyMod, href, input, label, mods, option, select, setupSvgIcon, span, style, target, title, type } from "./htmlgen"
import { makeIcon } from "./images"
import { DefaultLang, S, getLang, isLang, setLang } from "./strings"
import { Any, InBrowser, KeysOfByType, LogicValue, UIDisplay, copyToClipboard, deepArrayEquals, formatString, getURLParameter, isArray, isEmbeddedInIframe, isFalsyString, isRecord, isString, isTruthyString, onVisible, pasteFromClipboard, randomString, setDisplay, setVisible, showModal, toggleVisible, validateJson, valuesFromReprForInput } from "./utils"



enum Mode {
    STATIC,  // cannot interact in any way
    TRYOUT,  // can change inputs on predefined circuit
    CONNECT, // can additionnally move preexisting components around and connect them
    DESIGN,  // can additionally add components from left menu
    FULL,    // can additionally force output nodes to 'unset' state and draw undetermined dates
}

const MIN_MODE_INDEX: number = Mode.STATIC
const MAX_MODE_INDEX: number = Mode.FULL
const MAX_MODE_WHEN_SINGLETON = Mode.FULL
const MAX_MODE_WHEN_EMBEDDED = Mode.DESIGN
const DEFAULT_MODE = Mode.DESIGN

const SINGLETON_INSTANCE_ID = "_main"

const ATTRIBUTE_NAMES = {
    lang: "lang",
    singleton: "singleton", // whether this is the only editor in the page
    mode: "mode",
    id: "id",
    autosave: "autosave",
    hidereset: "hidereset",
    exportformat: "exportformat", // differences between MyST and pymarkdown

    // these are mirrored in the display options
    name: "name",
    showonly: "showonly",
    showgatetypes: "showgatetypes",
    showdisconnectedpins: "showdisconnectedpins",
    showtooltips: "tooltips",

    src: "src",
    data: "data",

    // set on the root div and not the custom element
    modes: "modes", // the space-separated list of cumulative modes whose UI elements should be shown
    nomodes: "nomodes",
} as const

export type InitParams = {
    orient: Orientation
}

const DEFAULT_EDITOR_OPTIONS = {
    name: undefined as string | undefined,
    showOnly: undefined as undefined | Array<string>,
    initParams: undefined as undefined | Record<string, Partial<InitParams>>,
    showGateTypes: false,
    showDisconnectedPins: false,
    wireStyle: WireStyles.auto as WireStyle,
    animateWires: false,
    hideWireColors: false,
    hideInputColors: false,
    hideOutputColors: false,
    hideMemoryContent: false,
    hideTooltips: false,
    groupParallelWires: false,
    showHiddenWires: false,
    showAnchors: false,
    showIDs: false,
    propagationDelay: 100,
    allowPausePropagation: false,
    zoom: 100,
}

export type EditorOptions = typeof DEFAULT_EDITOR_OPTIONS

export const PointerActions = {
    edit: {
        cursor: null,
        paramTypes: [],
    },
    move: {
        cursor: "move",
        paramTypes: [],
    },
    delete: {
        cursor: "not-allowed",
        paramTypes: [],
    },
    setanchor: {
        cursor: "alias",
        paramTypes: Any as [DrawableWithPosition],
    },
} as const satisfies Record<string, {
    cursor: string | null,
    paramTypes: any[]
}>

export type PoionterActionParams<M extends keyof typeof PointerActions> = typeof PointerActions[M]["paramTypes"]

export type PointerAction = keyof typeof PointerActions

type InitialData = { _type: "url", url: string } | { _type: "json", json: string } | { _type: "compressed", str: string }

type HighlightedItems = { comps: Component[], wires: Wire[], start: number }

export type DrawParams = {
    drawTime: number,
    drawTimeAnimationFraction: number | undefined,
    currentCompUnderPointer: Drawable | null,
    currentSelection: EditorSelection | undefined,
    highlightedItems: HighlightedItems | undefined,
    highlightColor: string | undefined,
    anythingMoving: boolean,
}

export class LogicEditor extends HTMLElement implements DrawableParent {

    public static _globalListenersInstalled = false
    private static _spaceDown = false
    public static get spaceDown() { return LogicEditor._spaceDown }

    public static _allConnectedEditors: Array<LogicEditor> = []
    public static get allConnectedEditors(): ReadonlyArray<LogicEditor> {
        return LogicEditor._allConnectedEditors
    }

    /// Accessible service singletons, defined once per editor ///

    public readonly factory = new ComponentFactory(this)
    public readonly eventMgr = new UIEventManager(this)
    public readonly timeline = new Timeline(this)

    /** EditTools are singleton-meant elements that help the general edition process, independently of
     * whether the editor is showing the main circuit or a CustomComponent. They are thus instantiated
     * only once by the main LogicEditor and can be accessed statically with `editor.editTools.xyz`
     * when needed. If, however, certain actions are done inside a circuit currently not being edited
     * (e.g., a CustomComponent that is closed, or the main circuit when a CustomComponent is open),
     * then use the `ifEditing?.xyz` to avoid having unwanted effects. */
    public readonly editTools: EditTools = {
        moveMgr: new MoveManager(this),
        undoMgr: new UndoManager(this),
        redrawMgr: new RedrawManager(),
        testsPalette: new TestsPalette(this),
        setDirty: this.setDirty.bind(this),
        setToolCursor: this.setToolCursor.bind(this),
    }


    /// DrawableParent implementation ///

    public isMainEditor(): this is LogicEditor { return true }
    public get editor(): LogicEditor { return this }

    public readonly components = new ComponentList()
    public readonly nodeMgr = new NodeManager()
    public readonly testSuites: TestSuites = new TestSuites(this)
    public readonly linkMgr: LinkManager = new LinkManager(this)
    public readonly recalcMgr = new RecalcManager()

    private _ifEditing: EditTools | undefined = this.editTools
    /** See #editTools */
    public get ifEditing() { return this._ifEditing }
    public stopEditingThis() { this._ifEditing = undefined }
    public startEditingThis(tools: EditTools) { this._ifEditing = tools }


    /// Other internal state ///

    private _isEmbedded = false
    private _isSingleton = false
    public get isSingleton() { return this._isSingleton }
    /** Mirrors the id HTML attribute, is used to preserve the state across a simple reload with sessionStorage */
    private _instanceId: string | undefined = undefined
    public get instanceId() { return this._instanceId }
    private get persistenceKey() { return this._instanceId === undefined ? undefined : "logic/" + this._instanceId }
    /** Stores the id used for exporting. This is generated once if we are in the standalone editor, or reused if we are in a populated instance */
    private _idWhenExporting: string | undefined = undefined
    public get idWhenExporting() { if (this._idWhenExporting === undefined) { this._idWhenExporting = randomString(6) } return this._idWhenExporting }
    /** Whether localStorage should be used in addition to sessionStorage, saving the state across page visits */
    private _autosave: boolean = false
    public get autosave() { return this._autosave }
    private _maxInstanceMode: Mode = MAX_MODE_WHEN_EMBEDDED // can be set later
    private _isDirty = false
    private _isRunningOrCreatingTests = false // when inputs are being set programmatically over a longer period
    private _dontHogFocus = false
    private _mode: Mode = DEFAULT_MODE
    public get mode() { return this._mode }
    private _initialData: InitialData | undefined = undefined
    private _options: EditorOptions = { ...DEFAULT_EDITOR_OPTIONS }
    private _hideResetButton = false
    private _exportformat: string | undefined = undefined

    private _menu: ComponentMenu | undefined = undefined
    private _topBar: TopBar | undefined = undefined
    private _messageBar: MessageBar | undefined = undefined
    private _toolCursor: string | null = null
    private _highlightedItems: HighlightedItems | undefined = undefined
    private _nextAnimationFrameHandle: number | null = null

    private _propagationPromise: Promise<void> = Promise.resolve()
    private _propagationResolve: (() => void) | undefined = undefined

    private _editorRoot: DrawableParent = this
    /** Either the LogicEditor itself, or a CustomComponent, whichever is being edited right now. */
    public get editorRoot() { return this._editorRoot }

    public root: ShadowRoot
    public readonly html: {
        rootDiv: HTMLDivElement,
        centerCol: HTMLDivElement,
        canvasContainer: HTMLElement,
        mainCanvas: HTMLCanvasElement,
        leftToolbar: HTMLElement,
        rightToolbarContainer: HTMLElement,
        rightResetButton: HTMLButtonElement,
        tooltipElem: HTMLElement,
        tooltipContents: HTMLElement,
        mainContextMenu: HTMLElement,
        fileChooser: HTMLInputElement,
        settingsPalette: HTMLElement,
        embedDialog: HTMLDialogElement,
        embedUrl: HTMLTextAreaElement,
        // embedUrlQRCode: HTMLImageElement,
        embedIframe: HTMLTextAreaElement,
        embedWebcomp: HTMLTextAreaElement,
        embedMarkdown: HTMLTextAreaElement,
    }
    public optionsHtml: {
        showGateTypesCheckbox: HTMLInputElement,
        showDisconnectedPinsCheckbox: HTMLInputElement,
        wireStylePopup: HTMLSelectElement,
        animateWiresCheckbox: HTMLInputElement,
        hideWireColorsCheckbox: HTMLInputElement,
        hideInputColorsCheckbox: HTMLInputElement,
        hideOutputColorsCheckbox: HTMLInputElement,
        hideMemoryContentCheckbox: HTMLInputElement,
        hideTooltipsCheckbox: HTMLInputElement,
        groupParallelWiresCheckbox: HTMLInputElement,
        showHiddenWiresCheckbox: HTMLInputElement,
        showAnchorsCheckbox: HTMLInputElement,
        showIdsCheckbox: HTMLInputElement,
        propagationDelayField: HTMLInputElement,
        showUserDataLinkContainer: HTMLDivElement,
    } | undefined = undefined
    public userdata: string | Record<string, unknown> | undefined = undefined

    private _baseUIDrawingScale = 1
    private _userDrawingScale = 1
    public get userDrawingScale() { return this._userDrawingScale }
    private _translationX = 0
    public get translationX() { return this._translationX }
    private _translationY = 0
    public get translationY() { return this._translationY }
    public pointerX = -1000 // offscreen at start
    public pointerY = -1000

    public constructor() {
        super()

        this.root = this.attachShadow({ mode: 'open' })
        this.root.appendChild(window.Logic.template.content.cloneNode(true) as HTMLElement)

        const html: typeof this.html = {
            rootDiv: this.elemWithId("logicEditorRoot"),
            centerCol: this.elemWithId("centerCol"),
            canvasContainer: this.elemWithId("canvas-sim"),
            mainCanvas: this.elemWithId("mainCanvas"),
            leftToolbar: this.elemWithId("leftToolbar"),
            rightToolbarContainer: this.elemWithId("rightToolbarContainer"),
            rightResetButton: this.elemWithId("rightResetButton"),
            tooltipElem: this.elemWithId("tooltip"),
            tooltipContents: this.elemWithId("tooltipContents"),
            mainContextMenu: this.elemWithId("mainContextMenu"),
            settingsPalette: this.elemWithId("settingsPalette"),
            fileChooser: this.elemWithId("fileChooser"),
            embedDialog: this.elemWithId("embedDialog"),
            embedUrl: this.elemWithId("embedUrl"),
            // embedUrlQRCode: this.elemWithId("embedUrlQRCode"),
            embedIframe: this.elemWithId("embedIframe"),
            embedWebcomp: this.elemWithId("embedWebcomp"),
            embedMarkdown: this.elemWithId("embedMarkdown"),
        }
        this.html = html
        dialogPolyfill.registerDialog(html.embedDialog)
    }


    private elemWithId<E extends Element>(id: string) {
        let elem = this.root.querySelector(`#${id}`)
        if (elem === null) {
            elem = document.querySelector(`#${id}`)
            if (elem !== null) {
                console.log(`WARNING found elem with id ${id} in document rather than in shadow root`)
            }
        }
        if (elem === null) {
            console.log("root", this.root)
            throw new Error(`Could not find element with id '${id}'`)
        }
        return elem as E
    }

    public static get observedAttributes() {
        return []
    }

    public get options(): Readonly<EditorOptions> {
        return this._options
    }

    public get documentDisplayName(): string {
        return this._options.name ?? S.Settings.DefaultFileName
    }

    public setPartialOptions(opts: Partial<EditorOptions>) {
        const newOptions = { ...DEFAULT_EDITOR_OPTIONS, ...opts }
        if (this._isSingleton) {
            // restore showOnly
            newOptions.showOnly = this._options.showOnly
        }
        this._options = newOptions
        let optionsHtml

        if ((optionsHtml = this.optionsHtml) !== undefined) {
            optionsHtml.animateWiresCheckbox.checked = newOptions.animateWires
            optionsHtml.hideWireColorsCheckbox.checked = newOptions.hideWireColors
            optionsHtml.hideInputColorsCheckbox.checked = newOptions.hideInputColors
            optionsHtml.hideOutputColorsCheckbox.checked = newOptions.hideOutputColors
            optionsHtml.hideMemoryContentCheckbox.checked = newOptions.hideMemoryContent
            optionsHtml.showGateTypesCheckbox.checked = newOptions.showGateTypes
            optionsHtml.wireStylePopup.value = newOptions.wireStyle
            optionsHtml.showDisconnectedPinsCheckbox.checked = newOptions.showDisconnectedPins
            optionsHtml.hideTooltipsCheckbox.checked = newOptions.hideTooltips
            optionsHtml.groupParallelWiresCheckbox.checked = newOptions.groupParallelWires
            optionsHtml.showHiddenWiresCheckbox.checked = newOptions.showHiddenWires
            optionsHtml.showAnchorsCheckbox.checked = newOptions.showAnchors
            optionsHtml.showIdsCheckbox.checked = newOptions.showIDs
            optionsHtml.propagationDelayField.valueAsNumber = newOptions.propagationDelay

            this.setWindowTitleFrom(newOptions.name)
            this._topBar?.setCircuitName(this.editor.options.name)
            this._topBar?.setZoom(newOptions.zoom)

            optionsHtml.showUserDataLinkContainer.style.display = this.userdata !== undefined ? "initial" : "none"
        }

        this._userDrawingScale = newOptions.zoom / 100

        this.editTools.redrawMgr.requestRedraw({ why: "options changed", invalidateMask: true, invalidateTests: true })
    }

    private setWindowTitleFrom(docName: string | undefined) {
        if (!this._isSingleton) {
            return
        }
        const defaultTitle = "Logic"
        if (docName === undefined) {
            document.title = defaultTitle
        } else {
            document.title = `${docName} – ${defaultTitle}`
        }
    }

    public nonDefaultOptions(): undefined | Partial<EditorOptions> {
        const nonDefaultOpts: Partial<EditorOptions> = {}
        let set = false
        for (const [_k, v] of Object.entries(this._options)) {
            const k = _k as keyof EditorOptions
            if (v !== DEFAULT_EDITOR_OPTIONS[k]) {
                nonDefaultOpts[k] = v as any
                set = true
            }
        }
        return set ? nonDefaultOpts : undefined
    }

    public runFileChooser(accept: string, callback: (file: File) => void) {
        const chooser = this.html.fileChooser
        chooser.setAttribute("accept", accept)
        chooser.addEventListener("change", () => {
            const files = this.html.fileChooser.files
            if (files !== null && files.length > 0) {
                callback(files[0])
            }
        }, { once: true })
        chooser.click()
    }

    public setToolCursor(cursor: string | null) {
        this._toolCursor = cursor
    }

    private setCanvasSize() {
        const { canvasContainer, mainCanvas } = this.html
        mainCanvas.style.setProperty("width", "0")
        mainCanvas.style.setProperty("height", "0")
        const w = canvasContainer.clientWidth
        const h = canvasContainer.clientHeight
        const f = window.devicePixelRatio ?? 1
        mainCanvas.setAttribute("width", String(w * f))
        mainCanvas.setAttribute("height", String(h * f))
        mainCanvas.style.setProperty("width", w + "px")
        mainCanvas.style.setProperty("height", h + "px")
        this._baseUIDrawingScale = f
    }

    public connectedCallback() {
        if (LogicEditor._allConnectedEditors.length === 0) {
            // set lang on first instance of editor on the page
            this.setupLang()
        }
        LogicEditor._allConnectedEditors.push(this)
        this.setup()
    }

    public disconnectedCallback() {
        const insts = LogicEditor._allConnectedEditors
        insts.splice(insts.indexOf(this), 1)

        // TODO
        // this.eventMgr.unregisterCanvasListenersOn(this.html.mainCanvas)
    }

    private setupLang() {

        const getNavigatorLanguage = () => {
            const lang = navigator.languages?.[0] ?? navigator.language
            if (lang.length > 2) {
                return lang.substring(0, 2)
            }
            if (lang.length === 2) {
                return lang
            }
            return undefined
        }

        const getSavedLang = () => {
            return localStorage.getItem(ATTRIBUTE_NAMES.lang)
        }

        const langStr = (getURLParameter(ATTRIBUTE_NAMES.lang)
            ?? this.getAttribute(ATTRIBUTE_NAMES.lang)
            ?? getSavedLang()
            ?? getNavigatorLanguage()
            ?? DefaultLang).toLowerCase()
        const lang = isLang(langStr) ? langStr : DefaultLang
        setLang(lang)
    }

    private setup() {
        const rootDiv = this.html.rootDiv
        const parentStyles = this.getAttribute("style")
        if (parentStyles !== null) {
            rootDiv.setAttribute("style", rootDiv.getAttribute("style") + parentStyles)
        }

        this._isEmbedded = isEmbeddedInIframe()
        const singletonAttr = this.getAttribute(ATTRIBUTE_NAMES.singleton)
        this._isSingleton = !this._isEmbedded && singletonAttr !== null && !isFalsyString(singletonAttr)
        this._maxInstanceMode = this._isSingleton && !this._isEmbedded ? MAX_MODE_WHEN_SINGLETON : MAX_MODE_WHEN_EMBEDDED
        this._exportformat = this.getAttribute(ATTRIBUTE_NAMES.exportformat) ?? undefined

        // Transfer from URL param to attributes if we are in singleton mode or embedded with data transferred in the URL
        if (this._isSingleton || this._isEmbedded) {
            const transferUrlParamToAttribute = (name: string) => {
                const value = getURLParameter(name)
                if (value !== undefined) {
                    this.setAttribute(name, value)
                }
            }

            for (const attr of [
                ATTRIBUTE_NAMES.mode,
                ATTRIBUTE_NAMES.id,
                ATTRIBUTE_NAMES.showonly,
                ATTRIBUTE_NAMES.showgatetypes,
                ATTRIBUTE_NAMES.showdisconnectedpins,
                ATTRIBUTE_NAMES.showtooltips,
                ATTRIBUTE_NAMES.data,
                ATTRIBUTE_NAMES.src,
                ATTRIBUTE_NAMES.hidereset,
            ]) {
                transferUrlParamToAttribute(attr)
            }

            const userParamPrefix = "user"
            const url = new URL(window.location.href)
            url.searchParams.forEach((value: string, key: string) => {
                if (key.startsWith(userParamPrefix)) {
                    key = key.substring(userParamPrefix.length)
                    if (key.startsWith(".")) {
                        key = key.substring(1)
                    }
                    if (key.length === 0) {
                        this.userdata = value
                    } else {
                        key = key[0].toLowerCase() + key.substring(1)
                        if (typeof this.userdata !== "object") {
                            this.userdata = {}
                        }
                        if (key in this.userdata) {
                            const oldValue = this.userdata[key]
                            if (isArray(oldValue)) {
                                oldValue.push(value)
                            } else {
                                this.userdata[key] = [oldValue, value]
                            }
                        } else {
                            this.userdata[key] = value
                        }
                    }
                }
            })
            if (this.userdata !== undefined) {
                console.log("Custom user data: ", this.userdata)
            }
        }

        if (this._isSingleton) {
            // console.log("LogicEditor is in singleton mode")

            // singletons manage their dark mode according to system settings
            const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)")
            darkModeQuery.onchange = () => {
                setDarkMode(darkModeQuery.matches, false)
            }
            setDarkMode(darkModeQuery.matches, true)

            // reexport some libs
            window.JSON5 = JSON5

            // make load function available globally
            window.Logic.singleton = this
            window.load = this.loadCircuitOrLibrary.bind(this)
            window.save = this.save.bind(this)
            window.highlight = this.highlight.bind(this)

            window.logicalTime = () => {
                const time = this.timeline.logicalTime()
                // console.log(time)
                return time
            }

            const madeBy =
                div(cls("noselect"), style("position: absolute; bottom: 0; right: 0; padding: 5px 3px 2px 5px; color: rgba(128,128,128,0.2); border-radius: 10px 0 0 0; font-size: 69%; font-style: italic;"),
                    S.Messages.DevelopedBy + " ",
                    a(style("color: inherit"),
                        href("https://github.com/jppellet/Logic-Circuit-Simulator"), target("_blank"),
                        "Jean-Philippe Pellet"
                    ),
                    ", ",
                    a(style("color: inherit"),
                        href("https://www.hepl.ch/accueil/formation/unites-enseignement-et-recherche/medias-usages-numeriques-et-didactique-de-linformatique.html"), target("_blank"),
                        "HEP Vaud"
                    ),
                ).render()

            // insert as first child
            this.html.canvasContainer.insertAdjacentElement("afterbegin", madeBy)

            window.onbeforeunload = e => {
                if (this._isSingleton && this._isDirty && this.mode >= Mode.CONNECT) {
                    e.preventDefault() // ask to save changes
                    e.returnValue = S.Messages.ReallyCloseWindow
                }
            }

            // if we lose the focus, we grab it back (if we're in singleton mode),
            // otherwise key events won't be caught
            this.addEventListener("focusout", () => {
                if (!this._dontHogFocus) {
                    this.focus()
                }
            })

            this.focus()
        }

        // Load parameters from attributes
        let modeAttr = this.getAttribute(ATTRIBUTE_NAMES.mode)
        if (modeAttr !== null && (modeAttr = modeAttr.toUpperCase()) in Mode) {
            this._maxInstanceMode = (Mode as any)[modeAttr]
        }

        const autosaveAttr = this.getAttribute(ATTRIBUTE_NAMES.autosave)
        if (autosaveAttr !== null && !isFalsyString(autosaveAttr)) {
            this._autosave = true
        }

        const idAttr = this.getAttribute(ATTRIBUTE_NAMES.id)
        if (idAttr !== null || this._isSingleton) {
            if (idAttr !== null) {
                this._instanceId = idAttr
                if (idAttr !== SINGLETON_INSTANCE_ID) {
                    this._idWhenExporting = idAttr
                }
            } else {
                this._instanceId = SINGLETON_INSTANCE_ID // default id for singleton
            }
        } else {
            const fct = this._autosave ? "error" : "warn"
            console[fct]("No id attribute on logic-editor, undownloaded state will be lost", this)
            this._autosave = false
        }

        const showonlyAttr = this.getAttribute(ATTRIBUTE_NAMES.showonly)
        if (showonlyAttr !== null) {
            this._options.showOnly = showonlyAttr.toLowerCase().split(/[, +]+/).filter(x => x.trim())
        }

        const showgatetypesAttr = this.getAttribute(ATTRIBUTE_NAMES.showgatetypes)
        if (showgatetypesAttr !== null) {
            this._options.showGateTypes = isTruthyString(showgatetypesAttr)
        }

        const showdisconnectedpinsAttr = this.getAttribute(ATTRIBUTE_NAMES.showdisconnectedpins)
        if (showdisconnectedpinsAttr !== null) {
            this._options.showDisconnectedPins = isTruthyString(showdisconnectedpinsAttr)
        }

        const showtooltipsAttr = this.getAttribute(ATTRIBUTE_NAMES.showtooltips)
        if (showtooltipsAttr !== null) {
            this._options.hideTooltips = !isFalsyString(showtooltipsAttr)
        }

        // TODO move this to options so that it is correctly persisted, too
        this._hideResetButton = this.getAttribute(ATTRIBUTE_NAMES.hidereset) !== null && !isFalsyString(this.getAttribute(ATTRIBUTE_NAMES.hidereset))

        let dataOrSrcRef
        if ((dataOrSrcRef = this.getAttribute(ATTRIBUTE_NAMES.data)) !== null) {
            this._initialData = { _type: "compressed", str: dataOrSrcRef }
        } else if ((dataOrSrcRef = this.getAttribute(ATTRIBUTE_NAMES.src)) !== null) {
            this._initialData = { _type: "url", url: dataOrSrcRef }
        } else {

            const tryLoadFromLightDOM = () => {
                const innerScriptElem = this.findLightDOMChild("script")
                if (innerScriptElem !== null) {
                    this._initialData = { _type: "json", json: innerScriptElem.innerHTML }
                    innerScriptElem.remove() // remove the data element to hide the raw data
                    // do this manually
                    this.tryLoadCircuitFromData(true, false)
                    this.doRedraw(true)
                    return true
                } else {
                    return false
                }
            }

            // try to load from the children of the light DOM,
            // but this has to be done later as it hasn't been parsed yet
            setTimeout(() => {
                const loaded = tryLoadFromLightDOM()

                // sometimes the light DOM is not parsed yet, so try again a bit later
                if (!loaded) {
                    setTimeout(() => {
                        tryLoadFromLightDOM()
                    }, 100)
                }
            })
        }

        const setCaption = (buttonId: string, strings: string | [string, string]) => {
            const elem = this.elemWithId(buttonId)
            const [name, tooltip] = isString(strings) ? [strings, undefined] : strings
            elem.insertAdjacentText("beforeend", name)
            if (tooltip !== undefined) {
                elem.setAttribute("title", tooltip)
            }
        }

        // set strings in the UI
        const s = S.Dialogs.Share
        setCaption("shareDialogTitle", s.title)
        setCaption("shareDialogUrl", s.URL)
        setCaption("shareDialogIframe", s.EmbedInIframe)
        setCaption("shareDialogWebComp", s.EmbedWithWebComp)
        setCaption("shareDialogMarkdown", s.EmbedInMarkdown)
        setCaption("shareDialogClose", S.Dialogs.Generic.Close)

        this._topBar = new TopBar(this)
        this._menu = new ComponentMenu(this, this.html.leftToolbar)
        this._messageBar = new MessageBar(this)
        const testResultsPalette = this.elemWithId("testResultsPalette")
        testResultsPalette.parentElement!.replaceChild(this.editTools.testsPalette.rootElem, testResultsPalette)

        // TODO move this to the Def of LabelRect to be cleaner
        const groupButton = this.html.leftToolbar.querySelector("button.sim-component-button[data-type=rect]")
        if (groupButton === null) {
            if (this._options.showOnly === undefined) {
                // else, it was probably hidden on purpose
                console.log("ERROR: Could not find group button")
            }
        } else {
            groupButton.addEventListener("pointerdown", this.wrapHandler(e => {
                const success = this.makeGroupWithSelection()
                if (success) {
                    e.preventDefault()
                    e.stopImmediatePropagation()
                }
            }))
        }

        this.eventMgr.registerCanvasListenersOn(this.html.mainCanvas)

        this.eventMgr.registerButtonListenersOn(this._menu.allFixedButtons(), false)

        this.html.rightResetButton.addEventListener("click", this.wrapHandler(this.resetCircuit.bind(this)))

        const showModeChange = this._maxInstanceMode >= Mode.FULL
        if (showModeChange) {
            const modeChangeMenu: HTMLElement = this.elemWithId("modeChangeMenu")!
            const titleElem = div(cls("toolbar-title"),
                "Mode",
            ).render()
            this.eventMgr.registerTitleDragListenersOn(titleElem)
            mods(
                titleElem,
                div(cls("btn-group-vertical"),
                    ...[Mode.FULL, Mode.DESIGN, Mode.CONNECT, Mode.TRYOUT, Mode.STATIC].map((buttonMode) => {
                        const [[modeTitle, expl], addElem] = (() => {
                            switch (buttonMode) {
                                case Mode.FULL: {
                                    const optionsDiv =
                                        div(cls("sim-mode-link"),
                                            title(S.Settings.Settings),
                                            makeIcon("settings")
                                        ).render()

                                    optionsDiv.addEventListener("click", () => {
                                        toggleVisible(this.html.settingsPalette)
                                    })

                                    return [S.Modes.FULL, optionsDiv]
                                }
                                case Mode.DESIGN: return [S.Modes.DESIGN, emptyMod]
                                case Mode.CONNECT: return [S.Modes.CONNECT, emptyMod]
                                case Mode.TRYOUT: return [S.Modes.TRYOUT, emptyMod]
                                case Mode.STATIC: return [S.Modes.STATIC, emptyMod]
                            }
                        })()

                        const copyLinkDiv =
                            div(cls("sim-mode-link"),
                                title("Copie un lien vers ce contenu dans ce mode"),
                                makeIcon("link"),
                            ).render()

                        copyLinkDiv.addEventListener("click", __ => {
                            this.shareSheetForMode(buttonMode)
                        })

                        const switchToModeDiv =
                            div(cls("btn btn-sm btn-outline-light sim-toolbar-button-right sim-mode-tool"),
                                style("display: flex; justify-content: space-between; align-items: center"),
                                attrBuilder("mode")(Mode[buttonMode].toLowerCase()),
                                title(expl),
                                modeTitle,
                                addElem,
                                copyLinkDiv
                            ).render()

                        switchToModeDiv.addEventListener("click", () => this.setMode(buttonMode, true))

                        return switchToModeDiv
                    })
                )
            ).applyTo(modeChangeMenu)
            setVisible(modeChangeMenu, true)
        }

        // this.html.embedUrlQRCode.addEventListener("click", __ => {
        //     // download
        //     const dataUrl = this.html.embedUrlQRCode.src
        //     const filename = this.documentDisplayName + "_qrcode.png"
        //     downloadDataUrl(dataUrl, filename)
        // })

        const selectAllListener = (e: Event) => {
            const textArea = e.target as HTMLTextAreaElement
            textArea.focus()
            textArea.select()
            e.preventDefault()
        }
        for (const textArea of [this.html.embedUrl, this.html.embedIframe, this.html.embedWebcomp, this.html.embedMarkdown]) {
            textArea.addEventListener("pointerdown", selectAllListener)
            textArea.addEventListener("focus", selectAllListener)
        }

        this.setCurrentPointerAction("edit", true)
        this.timeline.reset()

        // Options
        const settingsPalette = this.html.settingsPalette
        const settingsTitleElem = div(cls("toolbar-title with-border"), S.Settings.Settings).render()
        this.eventMgr.registerTitleDragListenersOn(settingsTitleElem, () => {
            setVisible(settingsPalette, false)
        })
        settingsPalette.insertAdjacentElement("afterbegin", settingsTitleElem)

        const makeCheckbox = <K extends KeysOfByType<EditorOptions, boolean>>(optionName: K, [title, mouseover]: [string, string], hide = false) => {
            const checkbox = input(type("checkbox")).render()
            if (this.options[optionName] === true) {
                checkbox.checked = true
            }
            checkbox.addEventListener("change", this.wrapHandler(() => {
                this._options[optionName] = checkbox.checked
                this.editTools.redrawMgr.requestRedraw({ why: "option changed: " + optionName, invalidateMask: true, invalidateTests: true })
                this.focus()
            }))
            const section = div(
                style("height: 20px"),
                label(checkbox, span(style("margin-left: 4px"), attr("title", mouseover), title))
            ).render()
            settingsPalette.appendChild(section)
            if (hide) {
                setVisible(section, false)
            }
            return checkbox
        }

        const animateWiresCheckbox = makeCheckbox("animateWires", S.Settings.animateWires)
        const hideWireColorsCheckbox = makeCheckbox("hideWireColors", S.Settings.hideWireColors)
        const hideInputColorsCheckbox = makeCheckbox("hideInputColors", S.Settings.hideInputColors)
        const hideOutputColorsCheckbox = makeCheckbox("hideOutputColors", S.Settings.hideOutputColors)
        const hideMemoryContentCheckbox = makeCheckbox("hideMemoryContent", S.Settings.hideMemoryContent)
        const showGateTypesCheckbox = makeCheckbox("showGateTypes", S.Settings.showGateTypes)
        const showDisconnectedPinsCheckbox = makeCheckbox("showDisconnectedPins", S.Settings.showDisconnectedPins)
        const hideTooltipsCheckbox = makeCheckbox("hideTooltips", S.Settings.hideTooltips)
        const groupParallelWiresCheckbox = makeCheckbox("groupParallelWires", S.Settings.groupParallelWires, true)
        const showHiddenWiresCheckbox = makeCheckbox("showHiddenWires", S.Settings.showHiddenWires)
        const showAnchorsCheckbox = makeCheckbox("showAnchors", S.Settings.showAnchors)
        const showIdsCheckbox = makeCheckbox("showIDs", S.Settings.showIds)
        // 
        const sw = S.Components.Wire.contextMenu
        const wireStylePopup = select(
            option(attr("value", WireStyles.auto), sw.WireStyleAuto),
            option(attr("value", WireStyles.straight), sw.WireStyleStraight),
            option(attr("value", WireStyles.hv), sw.WireStyleSquareHV),
            option(attr("value", WireStyles.vh), sw.WireStyleSquareVH),
            option(attr("value", WireStyles.bezier), sw.WireStyleCurved),
        ).render()
        wireStylePopup.addEventListener("change", this.wrapHandler(() => {
            this._options.wireStyle = wireStylePopup.value as WireStyle
            this.linkMgr.invalidateAllWirePaths()
            this.editTools.redrawMgr.requestRedraw({ why: "wire style changed", invalidateMask: true })
        }))
        settingsPalette.appendChild(
            div(
                style("height: 20px"),
                S.Settings.wireStyle + " ", wireStylePopup
            ).render()
        )

        const propagationDelayField = input(type("number"),
            style("margin: 0 4px; width: 4em"),
            attr("min", "0"), attr("step", "50"),
            attr("value", String(this.options.propagationDelay)),
            attr("title", S.Settings.propagationDelay),
        ).render()
        propagationDelayField.addEventListener("change", () => {
            this._options.propagationDelay = propagationDelayField.valueAsNumber
        })
        settingsPalette.appendChild(
            div(
                style("height: 20px"),
                S.Settings.propagationDelayField[0], propagationDelayField, S.Settings.propagationDelayField[1]
            ).render()
        )

        const showUserdataLink = a(S.Settings.showUserDataLink[1], style("text-decoration: underline; cursor: pointer")).render()
        showUserdataLink.addEventListener("click", () => {
            alert(S.Settings.userDataHeader + "\n\n" + JSON5.stringify(this.userdata, undefined, 4))
        })
        const showUserDataLinkContainer = div(
            style("margin-top: 5px; display: none"),
            S.Settings.showUserDataLink[0], showUserdataLink,
        ).render()
        settingsPalette.appendChild(showUserDataLinkContainer)

        this.optionsHtml = {
            animateWiresCheckbox,
            hideWireColorsCheckbox,
            hideInputColorsCheckbox,
            hideOutputColorsCheckbox,
            hideMemoryContentCheckbox,
            wireStylePopup,
            showGateTypesCheckbox,
            showDisconnectedPinsCheckbox,
            hideTooltipsCheckbox,
            groupParallelWiresCheckbox,
            showHiddenWiresCheckbox,
            showAnchorsCheckbox,
            showIdsCheckbox,
            propagationDelayField,
            showUserDataLinkContainer,
        }

        // this is called once here to set the initial transform and size before the first draw, and again later
        this.setCanvasSize()

        // force redraw the first time the canvas is visible; this also sets the size
        onVisible(this.html.canvasContainer, () => {
            this.redraw()
        })

        this.tryLoadCircuitFromData(true, false)
        // also triggers redraw, should be last thing called here

        this.setModeFromString(this.getAttribute(ATTRIBUTE_NAMES.mode))

        // this is called a second time here because the canvas width may have changed following the mode change
        this.setCanvasSize()
        LogicEditor.installGlobalListeners()

        this.doRedraw(true)
    }

    private findLightDOMChild<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K] | null {
        const TAGNAME = tagName.toUpperCase()
        for (const child of this.children) {
            if (child.tagName === TAGNAME) {
                return child as HTMLElementTagNameMap[K]
            }
        }
        return null
    }

    public static installGlobalListeners() {
        if (LogicEditor._globalListenersInstalled) {
            return
        }

        window.decompress = LZString.decompressFromEncodedURIComponent
        window.decodeOld = LogicEditor.decodeFromURLOld

        window.formatString = formatString

        // make gallery available globally
        window.gallery = gallery

        const makeUpdatePointerPositionHandler = (closingContextMenus: boolean) => (e: PointerEvent) => {
            for (const editor of LogicEditor._allConnectedEditors) {

                // Update X and Y coordinates of the pointer
                const canvasContainer = editor.html.canvasContainer
                if (canvasContainer !== undefined) {
                    const canvasPos = canvasContainer.getBoundingClientRect()
                    // first, compute the coordinates ignoring the zoom and translation
                    const x = e.clientX - canvasPos.left
                    const y = e.clientY - canvasPos.top
                    // then, apply the zoom and translation
                    editor.pointerX = x / editor._userDrawingScale - editor._translationX
                    editor.pointerY = y / editor._userDrawingScale - editor._translationY
                    // console.log(`Pointer position: ${editor.pointerX}, ${editor.pointerY}`)
                }

                // If needed, hide the context menu
                if (closingContextMenus) {
                    editor.eventMgr.hideContextMenuIfNeeded(e)
                }
            }
        }

        window.addEventListener("pointerdown", makeUpdatePointerPositionHandler(true), true)
        window.addEventListener("pointermove", makeUpdatePointerPositionHandler(false), true)

        const updateCursors = () => {
            for (const editor of LogicEditor._allConnectedEditors) {
                editor.updateCursor()
            }
        }
        window.addEventListener("keydown", e => {
            if (e.key === " ") {
                LogicEditor._spaceDown = true
                updateCursors()
            }
        })
        window.addEventListener("keyup", e => {
            if (e.key === " ") {
                LogicEditor._spaceDown = false
                updateCursors()
            }
        })

        window.addEventListener("resize", () => {
            for (const editor of LogicEditor._allConnectedEditors) {
                const canvasContainer = editor.html.canvasContainer
                if (canvasContainer !== undefined) {
                    editor.wrapHandler(() => {
                        editor.setCanvasSize()
                        editor.editTools.redrawMgr.requestRedraw({ why: "window resized", invalidateMask: true })
                    })()
                }
                editor._topBar?.updateCompactMode()
            }
            registerPixelRatioListener()
        })

        let pixelRatioMediaQuery: undefined | MediaQueryList
        const registerPixelRatioListener = () => {
            if (pixelRatioMediaQuery !== undefined) {
                pixelRatioMediaQuery.onchange = null
            }

            const queryString = `(resolution: ${window.devicePixelRatio}dppx)`
            pixelRatioMediaQuery = window.matchMedia(queryString)
            pixelRatioMediaQuery.onchange = () => {
                for (const editor of LogicEditor._allConnectedEditors) {
                    editor.wrapHandler(() => {
                        editor.setCanvasSize()
                        editor.editTools.redrawMgr.requestRedraw({ why: "devicePixelRatio changed", invalidateMask: true })
                    })()
                }
                registerPixelRatioListener()
            }
        }
        registerPixelRatioListener()

        document.body.addEventListener("themechanged", (e) => {
            const isDark = Boolean((e as any).detail?.is_dark_theme)
            setDarkMode(isDark, false)
        })

        const mkdocsThemeObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.type === "attributes" && mutation.attributeName === "data-md-color-switching" && document.body.getAttribute("data-md-color-switching") === null) {
                    const newBackgroundColor = getComputedStyle(document.body).backgroundColor
                    console.log("Logic: looks like new background color is " + newBackgroundColor)
                    window.Logic.setDarkMode(newBackgroundColor)
                }
            })
        })

        mkdocsThemeObserver.observe(document.body, { attributes: true })

        LogicEditor._globalListenersInstalled = true
    }

    public setMode(mode: Mode, doSetFocus: boolean) {
        this.wrapHandler(() => {
            let modeStr = Mode[mode].toLowerCase()
            if (mode > this._maxInstanceMode) {
                mode = this._maxInstanceMode
                console.log(`Cannot switch to mode ${modeStr} because we are capped by ${Mode[this._maxInstanceMode]}`)
                modeStr = Mode[mode].toLowerCase()
            }
            this._mode = mode

            const modes: string[] = []
            for (let i = MIN_MODE_INDEX; i <= mode; i++) {
                modes.push(Mode[i].toLowerCase())
            }
            this.html.rootDiv.setAttribute(ATTRIBUTE_NAMES.modes, modes.join(" "))
            const nomodes: string[] = []
            for (let i = mode + 1; i <= MAX_MODE_INDEX; i++) {
                nomodes.push(Mode[i].toLowerCase())
            }
            this.html.rootDiv.setAttribute(ATTRIBUTE_NAMES.nomodes, nomodes.join(" "))

            // console.log(`Current mode is ${modeStr} - ${mode}`)

            this.editTools.redrawMgr.requestRedraw({ why: "mode changed", invalidateMask: true })

            // update mode active button
            this.root.querySelectorAll(".sim-mode-tool").forEach((elem) => {
                if (elem.getAttribute("mode") === modeStr) {
                    elem.classList.add("active")
                } else {
                    elem.classList.remove("active")
                }
            })

            if (mode < Mode.CONNECT) {
                this.setCurrentPointerAction("edit")
            }

            const showComponentsAndEditControls: UIDisplay =
                mode >= Mode.DESIGN ? "show" :
                    (this._maxInstanceMode >= Mode.DESIGN ? "inactive" : "hide")

            const showEditControls = showComponentsAndEditControls === "show"
            const showReset = mode >= Mode.TRYOUT && !this._hideResetButton
            const showOnlyReset = showReset && !showEditControls
            const hideSettings = mode < Mode.FULL

            this._topBar?.setButtonStateFromMode({ showComponentsAndEditControls, showReset }, mode)

            setVisible(this.html.rightToolbarContainer, showOnlyReset)

            if (hideSettings) {
                setVisible(this.html.settingsPalette, false)
            }

            setDisplay(this.html.leftToolbar, showComponentsAndEditControls)

            if (mode < Mode.CONNECT) {
                this.setTestsPaletteVisible(false)
            } else {
                this.didLoadTests(this.testSuites)
            }
            // const showTxGates = mode >= Mode.FULL && (showOnly === undefined || showOnly.includes("TX") || showOnly.includes("TXA"))
            // const txGateButton = this.root.querySelector("button[data-type=TXA]") as HTMLElement
            // setVisible(txGateButton, showTxGates)

            if (doSetFocus) {
                this.focus()
            }

        })()
    }

    public setModeFromString(modeStr: string | null) {
        let mode: Mode = this._maxInstanceMode
        if (modeStr !== null && (modeStr = modeStr.toUpperCase()) in Mode) {
            mode = (Mode as any)[modeStr]
        }
        this.setMode(mode, false)
    }

    public setCircuitName(name: string | undefined) {
        this._options.name = (name === undefined || name.length === 0) ? undefined : name
        this._topBar?.setCircuitName(name)
        this.setWindowTitleFrom(this._options.name)
    }

    public setZoom(zoom: number, updateTopBar: boolean): number {
        zoom = Math.max(10, Math.min(1000, zoom))
        const roundedZoomForUI = Math.round(zoom)
        this._options.zoom = roundedZoomForUI
        this._userDrawingScale = zoom / 100
        if (updateTopBar) {
            this._topBar?.setZoom(roundedZoomForUI)
        }
        this.editTools.redrawMgr.requestRedraw({ why: "zoom level changed", invalidateMask: true })
        return zoom
    }

    public setTranslation(tX: number, tY: number) {
        this._translationX = tX
        this._translationY = tY
        this.editTools.redrawMgr.requestRedraw({ why: "translation changed", invalidateMask: true })
    }

    public updateCustomComponentButtons() {
        if (this._menu !== undefined) {
            this._menu.updateCustomComponentButtons(this.factory.customDefs())
            this.eventMgr.registerButtonListenersOn(this._menu.allCustomButtons(), true)
        }
        this._topBar?.updateCustomComponentCaption()
    }

    public allowGateType(type: string) {
        return this._menu?.allowGateType(type) ?? true
    }

    public override focus() {
        this.html.mainCanvas.focus()
    }

    /**
     * This saves the passed circuit to both sessionStorage and localStorage.
     * The idea is that sessionStorage is always restored (page reload),
     * and localStorage items can be proposed in the UI for reloading.
     */
    public trySaveInBrowserStorage(circuit: Circuit) {
        const key = this.persistenceKey
        if (key === undefined) {
            // console.log("No persistence ID set, not saving circuit")
            return
        }

        const now = Date.now()
        const saveStr = now + ";" + Serialization.stringifyObject(circuit, true)
        try {
            sessionStorage.setItem(key, saveStr)
            if (this._autosave) {
                localStorage.setItem(key, saveStr)
                // console.log(`Saved circuit to session and local storage with key '${key}'`)
            } else {
                // console.log(`Saved circuit to session (not local) storage with key '${key}'`)
            }
        } catch (e) {
            console.error("Failed to save circuit to browser storage", e)
        }
    }

    /**
     * Automatically called upon load after the initial data has been loaded.
     * Allows to restore the circuit from the session storage only (local storage is
     * only upon user request).
     */
    public tryLoadFromSessionStorage(): boolean {
        const savedTime = this.tryLoadFromStorage(sessionStorage, false)
        if (savedTime === undefined) {
            return false
        }
        if (isString(savedTime)) {
            console.error("Failed to load circuit from session storage", savedTime)
            return false
        }
        this.showLoadedMessage(savedTime, true)
        return true
    }

    /**
     * This does something similar as `tryLoadFromSessionStorage` but it is initiated
     * by the user and should show errors
     */
    public tryLoadFromLocalStorage(): boolean {
        const savedTime = this.tryLoadFromStorage(localStorage, true)
        if (savedTime === undefined) {
            window.alert(S.Messages.NoSavedData)
            return false
        }

        if (isString(savedTime)) {
            window.alert(S.Messages.FailedToLoadCircuitFromStorage.expand({ error: savedTime }))
            console.error("Failed to load circuit from session storage", savedTime)
            return false
        }
        this.showLoadedMessage(savedTime, false)
        return true
    }

    private showLoadedMessage(savedTime: Date, keepOpen: boolean) {
        const day = savedTime.toLocaleDateString(undefined, {
            year: '2-digit',
            month: '2-digit',
            day: '2-digit',
        })
        const time = savedTime.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: undefined,
        })

        this.showMessage(S.Messages.LoadedCircuitFromSessionStorage.expand({ day, time }), keepOpen ? 0 : 2000, keepOpen)
    }

    /**
     * @returns undefined if no persistence id is set or nothing is saved; a string in case of an error to report; a Date if loaded successfully
     */
    private tryLoadFromStorage(storage: Storage, takeSnapshot: boolean): undefined | Date | string {
        const key = this.persistenceKey
        if (key === undefined) {
            return undefined
        }

        const savedStr = storage.getItem(key)
        if (savedStr === null || savedStr.length === 0) {
            // console.log(`Nothing to load from ${storage === localStorage ? "local" : "session"} storage with key '${key}'`)
            return undefined
        }
        // console.log(`Loading circuit from ${storage === localStorage ? "local" : "session"} storage with key '${key}'`)

        let semicolIndex = -1
        if ((semicolIndex = savedStr.indexOf(";")) === -1) {
            return "unparseable saved string"
        }

        const circuitStr = savedStr.substring(semicolIndex + 1)
        const error = Serialization.loadCircuitOrLibrary(this, circuitStr, takeSnapshot)
        if (error !== undefined) {
            return error
        }

        try {
            return new Date(Number(savedStr.substring(0, semicolIndex)))
        } catch (e) {
            return new Date()
        }
    }

    public tryClearBrowserStorage() {
        const key = this.persistenceKey
        if (key === undefined) {
            return
        }

        try {
            localStorage.removeItem(key)
        } catch (e) {
            // ignore
        }

        try {
            sessionStorage.removeItem(key)
        } catch (e) {
            // ignore
        }
    }

    public tryLoadFrom(file: File) {
        if (file.type === "application/json" || file.type === "application/json5" || file.type === "text/plain") {
            // JSON files can be circuits or libraries
            const reader = new FileReader()
            reader.onload = () => {
                const content = reader.result?.toString()
                if (content !== undefined) {
                    this.loadCircuitOrLibrary(content)
                }
            }
            reader.readAsText(file, "utf-8")

        } else if (file.type === "image/png") {
            // PNG files may contain a circuit in the metadata
            const reader = new FileReader()
            reader.onload = () => {
                const content = reader.result
                if (content instanceof ArrayBuffer) {
                    const uintArray2 = new Uint8Array(content)
                    const pngMetadata = pngMeta.readMetadata(uintArray2)
                    const compressedJSON = pngMetadata.tEXt?.Description
                    if (isString(compressedJSON)) {
                        this._initialData = { _type: "compressed", str: compressedJSON }
                        this.wrapHandler(() => {
                            this.tryLoadCircuitFromData(false, true)
                        })()
                    }
                }
            }
            reader.readAsArrayBuffer(file)

        } else if (file.type === "image/svg+xml") {
            // SVG files may contain a circuit in the metadata
            const reader = new FileReader()
            reader.onload = e => {
                const content = e.target?.result?.toString()
                if (content !== undefined) {

                    const temp = document.createElement("div")
                    temp.innerHTML = content
                    const metadata = temp.querySelector("svg metadata")
                    const json = metadata?.textContent
                    temp.remove()
                    if (json !== undefined && json !== null) {
                        this.loadCircuitOrLibrary(json)
                    }
                }
            }
            reader.readAsText(file, "utf-8")

        } else {
            this.showMessage(S.Messages.UnsupportedFileType.expand({ type: file.type }))
        }
    }

    public tryLoadCircuitFromData(tryLoadStorage: boolean, takeSnapshot: boolean) {
        // console.log(`tryLoadCircuitFromData with tryLoadStorage=${tryLoadStorage}, takeSnapshot=${takeSnapshot}`)
        if (this._initialData !== undefined) {

            // if URL, load and call the function again
            if (this._initialData._type === "url") {
                // load from URL
                const url = this._initialData.url
                // will only work within the same domain for now
                fetch(url, { mode: "cors" }).then(response => response.text()).then(json => {
                    console.log(`Loaded initial data from URL '${url}'`)
                    this._initialData = { _type: "json", json }
                    this.tryLoadCircuitFromData(tryLoadStorage, takeSnapshot)
                })

                // TODO try fetchJSONP if this fails?
                return
            }

            let error: undefined | string = undefined

            if (this._initialData._type === "json") {
                // already decompressed
                try {
                    error = Serialization.loadCircuitOrLibrary(this, this._initialData.json, takeSnapshot)
                } catch (e) {
                    error = String(e) + " (JSON)"
                }

            } else {
                let decodedData
                try {
                    decodedData = LZString.decompressFromEncodedURIComponent(this._initialData.str)
                    if (this._initialData.str.length !== 0 && (decodedData?.length ?? 0) === 0) {
                        throw new Error("zero decoded length")
                    }
                } catch (err) {
                    error = String(err) + " (LZString)"

                    // try the old, uncompressed way of storing the data in the URL
                    try {
                        decodedData = LogicEditor.decodeFromURLOld(this._initialData.str)
                        error = undefined
                    } catch (e) {
                        // swallow error from old format
                    }
                }

                if (error === undefined && isString(decodedData)) {
                    // remember the decompressed/decoded value
                    error = Serialization.loadCircuitOrLibrary(this, decodedData, takeSnapshot)
                    if (error === undefined) {
                        this._initialData = { _type: "json", json: decodedData }
                    }
                }
            }


            if (error !== undefined) {
                console.log("ERROR could not not load initial data: " + error)
            }
        }

        let isConsideredDirty = false
        if (tryLoadStorage) {
            // try restore from session storage
            if (this.tryLoadFromSessionStorage()) {
                isConsideredDirty = true
            }
        }

        if (!isConsideredDirty) {
            this.clearDirty()
        }
    }

    public resetCircuit() {
        this.tryClearBrowserStorage()
        this.editor.tryLoadCircuitFromData(false, false)
    }

    public tryCloseCustomComponentEditor() {
        const editorRoot = this.editor.editorRoot
        if (!(editorRoot instanceof CustomComponent)) {
            return false
        }
        const def = editorRoot.customDef
        const error = this.editor.factory.tryModifyCustomComponent(def, editorRoot)
        if (error !== undefined) {
            if (error.length !== 0) {
                window.alert(error)
            }
            return true // handled, even if with error
        }
        for (const type of this.factory.getCustomComponentTypesWhichUse(def.type)) {
            // console.log(`Updating custom component type '${type}'`)
            this.components.updateCustomComponents(type)
        }
        this.setEditorRoot(this.editor)
        this.editTools.undoMgr.takeSnapshot()
        return true
    }

    public loadCircuitOrLibrary(jsonStringOrObject: string | Record<string, unknown>) {
        this.wrapHandler(
            (jsonStringOrObject: string | Record<string, unknown>) =>
                Serialization.loadCircuitOrLibrary(this, jsonStringOrObject, true)
        )(jsonStringOrObject)
    }

    public makeGroupWithSelection(): boolean {
        const selectedComps = this.eventMgr.currentSelection?.previouslySelectedElements || new Set()
        if (selectedComps.size === 0) {
            return false
        }

        const newGroup = RectangleDef.make<Rectangle>(this)
        newGroup.setSpawned()

        if (newGroup instanceof Rectangle) {
            newGroup.wrapContents(selectedComps)
            for (const comp of selectedComps) {
                if (comp instanceof DrawableWithDraggablePosition && comp.anchor === undefined) {
                    comp.anchor = newGroup
                }
            }
        } else {
            console.log("ERROR: created component is not a Rectangle")
        }

        return true
    }

    public setDirty(__reason: string) {
        if (this.mode >= Mode.CONNECT) {
            // other modes can't be dirty
            this._isDirty = true
            this._topBar?.setDirty(true)
        }
    }

    public clearDirty() {
        this._isDirty = false
        this._topBar?.setDirty(false)
    }

    public setDark(dark: boolean) {
        this.html.rootDiv.classList.toggle("dark", dark)
    }

    public setEditorRoot(newRoot: DrawableParent) {
        if (newRoot === this._editorRoot) {
            return
        }

        if (this._editorRoot !== undefined) {
            this._editorRoot.stopEditingThis()
        }

        this._editorRoot = newRoot
        newRoot.startEditingThis(this.editTools)

        const [customComp, typesToHide] = !(newRoot instanceof CustomComponent)
            // case LogicEditor
            ? [undefined, []]
            // case CustomComponent
            : [newRoot, this.factory.getCustomComponentTypesWhichUse(newRoot.customDef.type)]

        this._menu?.setCustomComponentsHidden(typesToHide)
        this._topBar?.setEditingCustomComponent(customComp?.customDef)

        this._highlightedItems = undefined
        this.eventMgr.currentSelection = undefined
        this.eventMgr.clearTooltipIfNeeded()
        this.eventMgr.updateComponentUnderPointer([this.pointerX, this.pointerY], false, false, false)
        this.editTools.testsPalette.update()
        this.editTools.moveMgr.clear()
        this.editTools.redrawMgr.requestRedraw({ why: "editor root changed", invalidateMask: true, invalidateTests: true })

        this.focus()
    }

    public setCurrentPointerAction<M extends PointerAction>(action: M, forceUpdate: boolean = false, ...params: PoionterActionParams<M>): boolean {
        const changed = this.eventMgr.setHandlersFor(action, ...params)
        if (forceUpdate || changed) {
            this.setToolCursor(PointerActions[action].cursor)
            this._topBar?.updateActiveTool(action)
            this.editTools.redrawMgr.requestRedraw({ why: "mouse action changed" })
            this.editor.focus()
        }
        return changed
    }

    public updateCursor(e?: PointerEvent) {
        const cursor =
            this.editTools.moveMgr.areDrawablesMoving()
                ? "grabbing"
                : this._toolCursor
                ?? this.eventMgr.currentComponentUnderPointer?.cursorWhenMouseover(e)
                ?? (LogicEditor._spaceDown && this._mode >= Mode.CONNECT
                    ? "grab"
                    : "default")
        this.html.canvasContainer.style.cursor = cursor
    }

    public showMessage(msg: Modifier, duration: number = 2000, withCloseButton: boolean = false): () => void {
        return this._messageBar?.showMessage(msg, duration, withCloseButton) ?? (() => undefined)
    }

    public offsetXYForContextMenu(e: MouseEvent | PointerDragEvent, snapToGrid = false): [number, number] {
        const mainCanvas = this.html.mainCanvas
        let x, y

        if ("offsetX" in e && e.offsetX === 0 && e.offsetY === 0 && e.target === mainCanvas) {
            const canvasRect = mainCanvas.getBoundingClientRect()
            x = e.clientX - canvasRect.x
            y = e.clientY - canvasRect.y
        } else if ("dragStartX" in e) {
            return [e.dragStartX, e.dragStartY]
        } else {
            [x, y] = this.offsetXY(e)
        }

        if (snapToGrid) {
            x = Math.round(x / GRID_STEP) * GRID_STEP
            y = Math.round(y / GRID_STEP) * GRID_STEP
        }
        return [x, y]
    }

    public offsetXY(e: MouseEvent, skipTransform: boolean = false): [number, number] {
        const [unscaledX, unscaledY] = (() => {
            const mainCanvas = this.html.mainCanvas
            let target = e.target
            if ("offsetX" in e) {
                // MouseEvent
                const canvasRect = mainCanvas.getBoundingClientRect()
                let offsetX = e.offsetX
                let offsetY = e.offsetY

                // fix for firefox having always 0 offsetX,Y
                if (offsetX === 0 && offsetY === 0) {
                    const _e = e as any
                    if ("_savedOffsetX" in _e) {
                        offsetX = _e._savedOffsetX
                        offsetY = _e._savedOffsetY
                        target = _e._savedTarget
                    } else if ("layerX" in e) {
                        // This should never happen and is actually wrong, because we assume 
                        offsetX = _e.layerX + canvasRect.x
                        offsetY = _e.layerY + canvasRect.y
                    }
                }

                if (target === mainCanvas) {
                    return [offsetX, offsetY]
                } else {
                    const elemRect = (target as HTMLElement).getBoundingClientRect()
                    return [
                        Math.max(GRID_STEP * 2, offsetX + elemRect.x - canvasRect.x),
                        Math.max(GRID_STEP * 2, offsetY + elemRect.y - canvasRect.y),
                    ]
                }
            } else {
                console.error("calling offsetXY with TouchEvent")
                throw new Error("not implemented")
                // const elemRect = (target as HTMLElement).getBoundingClientRect()
                // const bodyRect = document.body.getBoundingClientRect()
                // const touch = e.changedTouches[0]
                // const offsetX = touch.pageX - (elemRect.left - bodyRect.left)
                // const offsetY = touch.pageY - (elemRect.top - bodyRect.top)

                // if (target === mainCanvas) {
                //     return [offsetX, offsetY]
                // } else {
                //     const canvasRect = mainCanvas.getBoundingClientRect()
                //     return [
                //         Math.max(GRID_STEP * 2, offsetX + elemRect.x - canvasRect.x),
                //         Math.max(GRID_STEP * 2, offsetY + elemRect.y - canvasRect.y),
                //     ]
                // }
            }
        })()
        const [f, tX, tY] = skipTransform ? [1, 0, 0] : [this._userDrawingScale, this._translationX, this._translationY]
        return [unscaledX / f - tX, unscaledY / f - tY]
    }

    public offsetXYForComponent(e: PointerEvent, comp: Component): [number, number] {
        const offset = this.offsetXY(e)
        if (comp.orient === Orientation.default) {
            return offset
        }
        const [x, y] = offset
        const dx = x - comp.posX
        const dy = y - comp.posY
        switch (comp.orient) {
            case "e": return offset // done before anyway
            case "w": return [comp.posX - dx, comp.posY - dy]
            case "s": return [comp.posX - dy, comp.posY - dx]
            case "n": return [comp.posX + dy, comp.posY + dx]
        }
    }

    private guessAdequateCanvasSize(applyZoom: boolean): [number, number] {
        let rightmostX = Number.NEGATIVE_INFINITY, leftmostX = Number.POSITIVE_INFINITY
        let lowestY = Number.NEGATIVE_INFINITY, highestY = Number.POSITIVE_INFINITY
        const drawables: DrawableWithPosition[] = [...this.editorRoot.components.all()]
        for (const wire of this.linkMgr.wires) {
            drawables.push(...wire.waypoints)
        }
        for (const comp of drawables) {
            const cx = comp.posX
            const width = comp.width
            const left = cx - width / 2
            const right = left + width
            if (right > rightmostX) {
                rightmostX = right
            }
            if (left < leftmostX) {
                leftmostX = left
            }

            const cy = comp.posY
            const height = comp.height
            const top = cy - height / 2
            const bottom = top + height
            if (bottom > lowestY) {
                lowestY = bottom
            }
            if (top < highestY) {
                highestY = top
            }
        }
        leftmostX = Math.max(0, leftmostX)
        let w = rightmostX + leftmostX // add right margin equal to left margin
        if (isNaN(w)) {
            w = 300
        }
        highestY = Math.max(0, highestY)
        let h = highestY + lowestY // add lower margin equal to top margin
        if (isNaN(h)) {
            h = 150
        }
        const f = applyZoom ? this._userDrawingScale : 1
        return [f * w, f * h]
    }

    public async shareSheetForMode(mode: Mode) {
        if (this._mode > MAX_MODE_WHEN_EMBEDDED) {
            this._mode = MAX_MODE_WHEN_EMBEDDED
        }
        const modeStr = Mode[mode].toLowerCase()
        const idWhenExporting = this.idWhenExporting
        const { fullJson, compressedJsonForUri, showOnlyArr } = this.fullJsonStateAndCompressedForUri(true)

        console.log("JSON:\n" + fullJson)

        const fullUrl = this.fullUrlForMode(mode, compressedJsonForUri, showOnlyArr, idWhenExporting)
        this.html.embedUrl.value = fullUrl

        const modeParam = mode === MAX_MODE_WHEN_EMBEDDED ? "" : `:mode: ${modeStr}`
        const embedHeight = this.guessAdequateCanvasSize(true)[1]

        const showOnlySpaceDelim = showOnlyArr === undefined ? undefined : showOnlyArr.join(" ")
        const markdownBlock =
            this._exportformat === "superfence"
                // superfence
                ? `\`\`\`{.logic id=${idWhenExporting} height=${embedHeight} mode=${modeStr}${showOnlySpaceDelim === undefined ? '' : `showonly=${showOnlySpaceDelim}`}}\n${fullJson}\n\`\`\``
                // default, myst-style
                : `\`\`\`{logic}\n:id: ${idWhenExporting}\n:height: ${embedHeight}\n${modeParam}\n${showOnlySpaceDelim === undefined ? '' : `:showonly: ${showOnlySpaceDelim}\n`}\n${fullJson}\n\`\`\``
        this.html.embedMarkdown.value = markdownBlock

        const showOnlyHtmlAttr = showOnlySpaceDelim === undefined ? "" : ` showonly="${showOnlySpaceDelim}"`

        const iframeEmbed = `<iframe style="width: 100%; height: ${embedHeight}px; border: 0"${showOnlyHtmlAttr} src="${fullUrl}"></iframe>`
        this.html.embedIframe.value = iframeEmbed

        const webcompEmbed = `<div style="width: 100%; height: ${embedHeight}px">\n  <logic-editor id="${idWhenExporting}" mode="${Mode[mode].toLowerCase()}"${showOnlyHtmlAttr}>\n    <script type="application/json5">\n      ${fullJson.replace(/\n/g, "\n      ")}\n    </script>\n  </logic-editor>\n</div>`
        this.html.embedWebcomp.value = webcompEmbed

        // const dataUrl = await QRCode.toDataURL(fullUrl, { margin: 0, errorCorrectionLevel: 'L' })
        // const qrcodeImg = this.html.embedUrlQRCode
        // qrcodeImg.src = dataUrl

        this.saveToUrl(compressedJsonForUri, showOnlyArr)

        if (!showModal(this.html.embedDialog)) {
            // alert("The <dialog> API is not supported by this browser")

            // TODO show the info some other way

            if (await copyToClipboard(fullUrl)) {
                console.log("  -> Copied!")
            } else {
                console.log("  -> Could not copy!")
            }
        }
    }

    public saveCurrentStateToUrl() {
        const { fullJson, compressedJsonForUri, showOnlyArr } = this.fullJsonStateAndCompressedForUri(true)
        console.log("Saved to URL compressed version of:\n" + fullJson)
        this.saveToUrl(compressedJsonForUri, showOnlyArr)
    }

    public save() {
        return Serialization.buildCircuitObject(this)
    }

    public saveToUrl(compressedUriSafeJson: string, showOnly: string[] | undefined) {
        if (this._isSingleton) {
            history.pushState(null, "", this.fullUrlForMode(MAX_MODE_WHEN_SINGLETON, compressedUriSafeJson, showOnly, this.instanceId))
            this.clearDirty()
            this.showMessage(S.Messages.SavedToUrl)
        }
    }

    /**
     * @param removeShowOnly if showOnly should be removed from the JSON (first returned value.). It is always removed from the compressed version for the URL, since it is an explicit URL parameter.
     */
    private fullJsonStateAndCompressedForUri(removeShowOnly: boolean): { fullJson: string, compressedJsonForUri: string, showOnlyArr: string[] | undefined } {
        let showOnlyArr: string[] | undefined = undefined
        const jsonObj = Serialization.buildCircuitObject(this)
        if (removeShowOnly) {
            showOnlyArr = Serialization.removeShowOnlyFrom(jsonObj)
        }
        const fullJson = Serialization.stringifyObject(jsonObj, false)
        if (!removeShowOnly) {
            showOnlyArr = Serialization.removeShowOnlyFrom(jsonObj)
        }
        const jsonForUri = Serialization.stringifyObject(jsonObj, true)

        // console.log("Full JSON:\n" + jsonFull)
        // console.log("JSON for URL:\n" + jsonForUri)

        // this can compress to like 40-50% of the original size
        const compressedJsonForUri = LZString.compressToEncodedURIComponent(jsonForUri)
        return { fullJson, compressedJsonForUri, showOnlyArr }
    }

    private fullUrlForMode(mode: Mode, compressedUriSafeJson: string, showOnlyArr: string[] | undefined, id: string | undefined): string {
        const loc = window.location
        const showOnlyParam = showOnlyArr === undefined ? "" : `&${ATTRIBUTE_NAMES.showonly}=${showOnlyArr.join(",")}`
        const currentLang = getLang()
        const hasCorrectLangParam = new URL(loc.href).searchParams.get(ATTRIBUTE_NAMES.lang) === currentLang
        const langParam = !hasCorrectLangParam ? "" // no param, keep default lang
            : `&${ATTRIBUTE_NAMES.lang}=${currentLang}` // keep currently set lang
        if (id === SINGLETON_INSTANCE_ID) {
            id = undefined
        }
        const idParam = id === undefined ? "" : `id=${id}&`
        return `${loc.protocol}//${loc.host}${loc.pathname}?${idParam}${ATTRIBUTE_NAMES.mode}=${Mode[mode].toLowerCase()}${langParam}${showOnlyParam}&${ATTRIBUTE_NAMES.data}=${compressedUriSafeJson}`
    }

    public toBase64(blob: Blob | null | undefined): Promise<string | undefined> {
        return new Promise((resolve, __) => {
            if (blob === null || blob === undefined) {
                resolve(undefined)
                return
            }
            const reader = new FileReader()
            reader.onloadend = () => {
                const dataURL = reader.result as string
                const asBase64 = dataURL.substring(dataURL.indexOf(",") + 1)
                resolve(asBase64)
            }
            reader.readAsDataURL(blob)
        })
    }

    public async toPNG(withMetadata: boolean, heightHint?: number): Promise<Blob | undefined> {
        const pngBareBlob = await new Promise<Blob | null>((resolve) => {
            const drawingScale = 3 // super retina
            let [width, height] = this.guessAdequateCanvasSize(false)
            if (heightHint !== undefined) {
                height = heightHint
            }
            width *= drawingScale
            height *= drawingScale

            const transform = new DOMMatrix().scale(drawingScale)

            const tmpCanvas = document.createElement('canvas')
            tmpCanvas.width = width
            tmpCanvas.height = height

            const g = LogicEditor.getGraphics(tmpCanvas)
            const wasDark = isDarkMode()
            if (wasDark) {
                setDarkMode(false, false)
            }
            this.doDrawWithContext(g, width, height, transform, transform, true, true, false)
            if (wasDark) {
                setDarkMode(true, false)
            }
            tmpCanvas.toBlob(resolve, 'image/png')
            tmpCanvas.remove()
        })

        if (pngBareBlob === null) {
            return undefined
        }

        if (!withMetadata) {
            return pngBareBlob
        }

        // else, add metadata
        const { compressedJsonForUri } = this.fullJsonStateAndCompressedForUri(false)
        const pngBareData = new Uint8Array(await pngBareBlob.arrayBuffer())
        const pngChunks = pngMeta.extractChunks(pngBareData)
        pngMeta.insertMetadata(pngChunks, { "tEXt": { "Description": compressedJsonForUri } })
        return new Blob([pngMeta.encodeChunks(pngChunks)], { type: "image/png" })
    }

    public async toSVG(withMetadata: boolean): Promise<Blob> {
        const metadata = !withMetadata ? undefined
            : Serialization.stringifyObject(Serialization.buildCircuitObject(this), false)

        const [width, height] = this.guessAdequateCanvasSize(false)
        const id = new DOMMatrix()
        const svgCtx = new SVGRenderingContext({ width, height, metadata })
        this.doDrawWithContext(svgCtx, width, height, id, id, true, true, false)
        const serializedSVG = svgCtx.getSerializedSvg()
        return Promise.resolve(new Blob([serializedSVG], { type: "image/svg+xml" }))
    }

    public async download(data: Promise<Blob | undefined>, extension: string) {
        const blob = await data
        if (blob === undefined) {
            return
        }
        const filename = this.documentDisplayName + extension
        saveAs(blob, filename)
    }

    public setTestsPaletteVisible(visible: boolean) {
        this.editTools.testsPalette.setVisible(visible)
        this._topBar?.updateTestPaletteVisible(visible)
    }

    public didLoadTests(testSuites: TestSuites) {
        const numTests = testSuites.totalCases()
        this._topBar?.setTestPaletteButtonVisible(numTests)
        this.setTestsPaletteVisible(numTests > 0)
    }

    public addTestCases(result: TestCaseCombinational | TestCaseCombinational[]) {
        let testSuite: TestSuite
        if (this.testSuites.suites.length > 0) {
            testSuite = this.testSuites.suites[0]
        } else {
            testSuite = new TestSuite()
            this.testSuites.push(testSuite)
        }
        if (!Array.isArray(result)) {
            testSuite.testCases.push(result)
        } else {
            testSuite.testCases.push(...result)
        }
        this.ifEditing?.setDirty("added test case")
        this.ifEditing?.undoMgr.takeSnapshot()
        this.ifEditing?.testsPalette.update()
    }

    public removeTestCase(testCase: TestCaseCombinational) {
        for (const testSuite of this.testSuites.suites) {
            const idx = testSuite.testCases.indexOf(testCase)
            if (idx >= 0) {
                testSuite.testCases.splice(idx, 1)
                this.ifEditing?.setDirty("removed test case")
                this.ifEditing?.undoMgr.takeSnapshot()
                this.ifEditing?.testsPalette.update()
                return
            }
        }
    }

    public async disableUIWhile<T>(message: string, action: (restoreAfter: Map<Input, LogicValue[]>) => Promise<T>): Promise<T | undefined> {
        if (this._isRunningOrCreatingTests) {
            // cannot run tests while already running
            return undefined
        }

        this._isRunningOrCreatingTests = true
        const oldMode = this.mode
        const restoreAfter = new Map<Input, LogicValue[]>()
        const hideMsg = this.showMessage(message, 0)

        try {
            this.setMode(Mode.STATIC, false)
            const result = await action(restoreAfter)
            return result
        } finally {
            hideMsg()
            this.setMode(oldMode, true)
            for (const [input, value] of restoreAfter) {
                input.setValue(value)
            }
            this.recalcPropagateAndDrawIfNeeded()
            await this.waitForPropagation()
            this._isRunningOrCreatingTests = false
        }

    }

    public async runTestSuite(testSuite: TestSuite | Record<string, unknown>, options?: { doLog?: boolean, fast?: boolean, noUI?: boolean }): Promise<TestSuiteResults | undefined> {

        const palette = this.editTools.testsPalette
        if (palette === undefined) {
            return undefined
        }

        const noUI = options?.noUI ?? false
        const fast = noUI || (options?.fast ?? false)
        const doLog = options?.doLog ?? false

        // do we need to load it from JSON?
        if (!(testSuite instanceof TestSuite)) {
            const testSuiteRepr = validateJson(testSuite, TestSuite.Repr, "test suite")
            if (testSuiteRepr === undefined) {
                return undefined
            }
            testSuite = new TestSuite([testSuiteRepr, this.editor.components])
        }

        return this.disableUIWhile(S.Messages.RunningTests, async restoreAfter => {

            this.setTestsPaletteVisible(true) // after setMode, which may hide it

            const results = new TestSuiteResults(testSuite)
            const ui = noUI ? undefined : palette.getOrMakeUIFor(testSuite)

            let isFirst = true
            let skip = false
            for (let i = 0; i < testSuite.testCases.length; i++) {
                const testCase = testSuite.testCases[i]
                ui?.setRunning(i)

                if (isFirst) {
                    isFirst = false
                } else if (!skip && !fast) {
                    // pause for 2 seconds
                    await new Promise(resolve => setTimeout(resolve, 2000))
                }
                let testCaseResult
                if (skip) {
                    testCaseResult = TestCaseResult.Skip
                } else {
                    const [oldInValues, result] = await this.runTestCase(testCase, testSuite, doLog)
                    testCaseResult = result
                    for (const [input, value] of oldInValues) {
                        if (!restoreAfter.has(input)) {
                            restoreAfter.set(input, value)
                        }
                    }
                }
                results.addTestCaseResult(testCase, testCaseResult)
                ui?.setResult(i, testCaseResult)
                if (testCase.stopOnFail && testCaseResult._tag === "fail") {
                    skip = true
                }
            }
            return results
        })
    }

    public trySetInputsAndRecalc(inputs: TestCaseValueMap<Input>) {
        for (const [input, valueRepr] of inputs) {
            if (!isString(input)) {
                input.setValue(valuesFromReprForInput(valueRepr, input.numBits))
            } else {
                console.error(`Input component ${input} not found`)
            }
        }
        this.recalcPropagateAndDrawIfNeeded(false)
    }

    private async runTestCase(
        testCase: TestCaseCombinational,
        sourceSuite: TestSuite,
        doLog: boolean
    ): Promise<[Map<Input, LogicValue[]>, TestCaseResult]> {

        if (doLog) {
            const fullTestNameParts = [sourceSuite.name, testCase.name].filter(Boolean)
            const fullTestName = fullTestNameParts.length === 0 ? S.Tests.DefaultTestCaseName : fullTestNameParts.join("/")
            console.group("Running test case " + fullTestName)
        }

        testCase.tryFixReferences(this.editorRoot.components)
        const oldInValues = new Map<Input, LogicValue[]>()
        try {
            for (const [input, valueRepr] of testCase.in) {
                if (isString(input)) {
                    return [oldInValues, TestCaseResult.Error(`Input component ${input} not found`)]
                }
                oldInValues.set(input, input.value)
                input.setValue(valuesFromReprForInput(valueRepr, input.numBits))
            }
            // console.log(`Propagation starting at ${this.timeline.logicalTime()}...`)
            this.recalcPropagateAndDrawIfNeeded(true)
            await this.waitForPropagation()
            // console.log(`Propagation done at ${this.timeline.logicalTime()}`)
            const mismatches: TestCaseResultMismatch[] = []
            for (const [output, expectedRepr] of testCase.out) {
                if (isString(output)) {
                    return [oldInValues, TestCaseResult.Error(`Output component ${output} not found`)]
                }
                const actual = output.value
                const expected = valuesFromReprForInput(expectedRepr, output.numBits)
                // console.log(`  ${outputName}: ${actual} (expected ${expected})`)
                if (!deepArrayEquals(actual, expected)) {
                    mismatches.push({ output, expected, actual })
                    if (doLog) {
                        const failMsg = `${output.ref} is ${actual} instead of ${expected}`
                        console.log(`%cFAIL:%c ${failMsg}`, 'color: red; font-weight: bold;', '')
                    }
                } else {
                    if (doLog) {
                        const passMsg = `${output.ref} is ${expected}`
                        console.log(`%cPASS:%c ${passMsg}`, 'color: green; font-weight: bold;', '')
                    }
                }
            }
            return [oldInValues, mismatches.length === 0 ? TestCaseResult.Pass : TestCaseResult.Fail(mismatches)]

        } finally {
            if (doLog) {
                console.groupEnd()
            }
        }
    }

    /**
     * Make sure that `recalcPropagateAndDrawIfNeeded` has been called after the change
     * with an argument of `true` to force the redraw and reset the promise if needed.
     */
    public waitForPropagation() {
        return this._propagationPromise
    }

    /**
     * @param forceNow This must be `true` only if we have just changed values manually
     * and we need to bypass and cancel the possible next animation frame to make sure we
     * renew the propagation promise right now. Otherwise, the next animation frame
     * will take care of the redraw.
     */
    public recalcPropagateAndDrawIfNeeded(forceNow: boolean = false) {
        if (this._nextAnimationFrameHandle !== null) {
            if (!forceNow) {
                // an animation frame will be played soon anyway
                return
            } else {
                cancelAnimationFrame(this._nextAnimationFrameHandle)
                this._nextAnimationFrameHandle = null
            }
        }

        const __recalculated = this.recalcMgr.recalcAndPropagateIfNeeded()

        const redrawMgr = this.editTools.redrawMgr
        const linkMgr = this._editorRoot.linkMgr
        if (linkMgr.isAddingWire || linkMgr.isSettingAnchor) {
            redrawMgr.requestRedraw({ why: "adding a wire/setting anchor" })
        }

        const animateWires = this._options.animateWires
        const redrawInfo = redrawMgr.getReasonsAndClear()
        if (redrawInfo === undefined && !animateWires) {
            return
        }

        // By now, we know that we have to redraw

        // we need to reset the promise if we have real redraw reasons, not only
        // a wire animate to run
        if (redrawInfo !== undefined && this._propagationResolve === undefined) {
            // console.log("new propagation promise")
            // means that the promise has been resolved already and we are
            // starting a new cycle, so we reset the promise
            this._propagationPromise = new Promise(resolve => {
                this._propagationResolve = resolve
            })
        }

        const redrawMask = redrawInfo?.redrawMask ?? false
        // console.log("Drawing " + (__recalculated ? "with" : "without") + " recalc, " + (redrawMask ? "with" : "without") + " redrawing mask, reasons:\n    " + (redrawInfo?.getReasons() ?? "??"))
        this.doRedraw(redrawMask)

        const invalidateTests = redrawInfo?.invalidateTests ?? false
        if (invalidateTests && !this._isRunningOrCreatingTests) {
            this.editTools.testsPalette.clearDisplayedResults()
        }

        if (!redrawMgr.isAnyValuePropagating()) {
            // console.log("No value is propagating")
            // if no value is propagating, we can resolve the promise, but after the
            // next timeline updates

            if (this._propagationResolve !== undefined) {
                // console.log("will maybe call _propagationResolve")
                // we cannot finish this now if there are pending callbacks
                // as they may change the state and we need to let them run

                if (!this.timeline.hasPendingCallbacksNow()) {
                    // console.log("-> yes")
                    // setTimeout(() => {
                    this._propagationResolve()
                    this._propagationResolve = undefined
                    // }, 0)
                } else {
                    // console.log("-> no, there are pending callbacks")
                }
            }
        }

        if (animateWires || redrawMgr.hasReasons()) {
            // an animation is running
            this._nextAnimationFrameHandle = requestAnimationFrame(() => {
                this._nextAnimationFrameHandle = null
                this.recalcPropagateAndDrawIfNeeded()
            })
        }
    }

    public highlight(refs: string | string[] | Component | undefined) {
        if (refs === undefined) {
            this._highlightedItems = undefined
            return
        }

        if (isString(refs)) {
            refs = [refs]
        }

        const highlightComps: Component[] = []
        const highlightWires: Wire[] = []

        if (!isArray(refs)) {
            // a single component
            highlightComps.push(refs)
        } else {
            for (const comp of this.components.all()) {
                if (comp.ref !== undefined && refs.includes(comp.ref)) {
                    highlightComps.push(comp)
                }
            }

            for (const wire of this.linkMgr.wires) {
                if (wire.ref !== undefined && refs.includes(wire.ref)) {
                    highlightWires.push(wire)
                }
            }

            if (highlightComps.length === 0 && highlightWires.length === 0) {
                console.log(`Nothing to highlight for ref '${refs}'`)
                this._highlightedItems = undefined
                return
            }
        }

        const start = this.timeline.unadjustedTime()
        this._highlightedItems = { comps: highlightComps, wires: highlightWires, start }
        this.editTools.redrawMgr.requestRedraw({ why: "highlighting component" })
        this.recalcPropagateAndDrawIfNeeded()
    }

    public redraw() {
        this.setCanvasSize()
        this.editTools.redrawMgr.requestRedraw({ why: "explicit redraw call", invalidateMask: true })
        this.recalcPropagateAndDrawIfNeeded()
    }

    private doRedraw(redrawMask: boolean) {
        // const timeBefore = performance.now()
        this._topBar?.updateTimeLabelIfNeeded()
        const g = LogicEditor.getGraphics(this.html.mainCanvas)
        const mainCanvas = this.html.mainCanvas
        const baseDrawingScale = this._baseUIDrawingScale

        const width = mainCanvas.width / baseDrawingScale
        const height = mainCanvas.height / baseDrawingScale
        // Recall that the matrices premultiply the coordinates, which means
        // that the first transform is applied last and the last one first
        const baseTransform = new DOMMatrix().scale(this._baseUIDrawingScale)
        const contentTransform = baseTransform.scale(this._userDrawingScale).translate(this._translationX, this._translationY)
        // console.log(`Drawing with zoom factor ${this._actualZoomFactor} and translation (${this._translationX}, ${this._translationY})`)
        this.doDrawWithContext(g, width, height, baseTransform, contentTransform, false, false, redrawMask)
        // const timeAfter = performance.now()
        // console.log(`Drawing took ${timeAfter - timeBefore}ms`)
    }

    private doDrawWithContext(g: GraphicsRendering, width: number, height: number, baseTransform: DOMMatrixReadOnly, contentTransform: DOMMatrixReadOnly, skipBorder: boolean, transparentBackground: boolean, __redrawMask: boolean) {

        // Draw order:
        // * Clear
        // * Highlight rectangles
        // * Grid
        // * Guidelines
        // * Border
        // * Components - background
        // * Wires
        // * Components - normal
        // * Anchors
        // * Components - overlays
        // * Refs
        // * Selection rect

        // if (redrawMask) {
        //     console.log("would redraw mask")
        // } else {
        //     console.log("would not redraw mask")
        // }

        g.setTransform(baseTransform)
        g.lineCap = "square"
        // eslint-disable-next-line no-restricted-syntax
        g.textBaseline = "alphabetic"

        // clear background
        g.fillStyle = COLOR_BACKGROUND
        if (transparentBackground) {
            g.clearRect(0, 0, width, height)
        } else {
            g.fillRect(0, 0, width, height)
        }
        g.setTransform(contentTransform)

        // draw highlight
        const highlightRectFor = (comp: Component) => {
            const margin = 15
            let w = comp.unrotatedWidth + margin + margin
            let h = comp.unrotatedHeight + margin + margin
            if (Orientation.isVertical(comp.orient)) {
                const t = w
                w = h
                h = t
            }
            return new DOMRect(comp.posX - w / 2, comp.posY - h / 2, w, h)
        }

        const highlightedItems = this._highlightedItems
        let highlightColor: string | undefined = undefined
        if (highlightedItems !== undefined) {
            const HOLD_TIME = 2000
            const FADE_OUT_TIME = 200
            const START_ALPHA = 0.4
            const elapsed = this.timeline.unadjustedTime() - highlightedItems.start
            const highlightAlpha = (elapsed < HOLD_TIME) ? START_ALPHA : START_ALPHA * (1 - (elapsed - HOLD_TIME) / FADE_OUT_TIME)
            if (highlightAlpha <= 0) {
                this._highlightedItems = undefined
            } else {

                g.beginPath()
                for (const comp of highlightedItems.comps) {
                    const highlightRect = highlightRectFor(comp)
                    g.moveTo(highlightRect.x, highlightRect.y)
                    g.lineTo(highlightRect.right, highlightRect.y)
                    g.lineTo(highlightRect.right, highlightRect.bottom)
                    g.lineTo(highlightRect.x, highlightRect.bottom)
                    g.closePath()
                }

                highlightColor = `rgba(238,241,0,${highlightAlpha})`
                g.shadowColor = highlightColor
                g.shadowBlur = 20
                g.shadowOffsetX = 0
                g.shadowOffsetY = 0
                g.fillStyle = highlightColor
                g.fill()

                g.shadowBlur = 0 // reset

                // will make it run until alpha is 0
                this.editTools.redrawMgr.requestRedraw({ why: "highlight animation" })
            }
        }

        // draw grid if moving comps
        const moveMgr = this.editTools.moveMgr
        // moveMgr.dump()
        const isMovingComponent = moveMgr.areDrawablesMoving()
        if (isMovingComponent) {
            // set the transform to the base one but still apply the zoom factor
            g.setTransform(baseTransform)
            g.scale(this._userDrawingScale, this._userDrawingScale)
            g.beginGroup("grid")
            const widthAdjusted = width / this._userDrawingScale
            const heightAdjusted = height / this._userDrawingScale
            const step = GRID_STEP //* 2
            g.strokeStyle = COLOR_GRID_LINES
            g.lineWidth = 1
            g.beginPath()
            for (let x = step; x < widthAdjusted; x += step) {
                g.moveTo(x, 0)
                g.lineTo(x, heightAdjusted)
            }
            for (let y = step; y < heightAdjusted; y += step) {
                g.moveTo(0, y)
                g.lineTo(widthAdjusted, y)
            }
            g.stroke()
            g.endGroup()
            g.setTransform(contentTransform)
        }

        // draw guidelines when moving waypoint
        const singleMovingWayoint = moveMgr.getSingleMovingWaypoint()
        if (singleMovingWayoint !== undefined) {
            g.beginGroup("guides")
            const guides = singleMovingWayoint.getPrevAndNextAnchors()
            g.strokeStyle = COLOR_GRID_LINES_GUIDES
            g.lineWidth = 1.5
            g.beginPath()
            for (const guide of guides) {
                g.moveTo(guide.posX, 0)
                g.lineTo(guide.posX, height)
                g.moveTo(0, guide.posY)
                g.lineTo(width, guide.posY)
            }
            g.stroke()
            g.endGroup()
        }

        // draw border according to mode
        if (!skipBorder && (this._mode >= Mode.CONNECT || this._maxInstanceMode === MAX_MODE_WHEN_SINGLETON)) {
            g.beginGroup("border")
            g.setTransform(baseTransform)
            g.strokeStyle = COLOR_BORDER
            g.lineWidth = 2
            if (this._maxInstanceMode === MAX_MODE_WHEN_SINGLETON && this._mode < this._maxInstanceMode) {
                g.strokeRect(0, 0, width, height)
                const h = this.guessAdequateCanvasSize(true)[1]
                strokeSingleLine(g, 0, h, width, h)

                g.fillStyle = COLOR_BACKGROUND_UNUSED_REGION
                g.fillRect(0, h, width, height - h)
            } else {
                // skip border where the top tab is
                const myX = this.html.mainCanvas.getBoundingClientRect().x
                const [x1, x2] = this._topBar?.getActiveTabCoords() ?? [0, 0]
                g.beginPath()
                g.moveTo(x1 - myX, 0)
                g.lineTo(0, 0)
                g.lineTo(0, height)
                g.lineTo(width, height)
                g.lineTo(width, 0)
                g.lineTo(x2 - myX, 0)
                g.stroke()
            }
            g.setTransform(contentTransform)
            g.endGroup()
        }

        // const currentScale = this._currentScale
        // g.scale(currentScale, currentScale)

        const drawTime = this.timeline.logicalTime()
        const drawTimeAnimationFraction = !this._options.animateWires ? undefined : (drawTime / 1000) % 1
        g.strokeStyle = COLOR_COMPONENT_BORDER
        const currentCompUnderPointer = this.eventMgr.currentComponentUnderPointer
        const drawParams: DrawParams = {
            drawTime,
            drawTimeAnimationFraction,
            currentCompUnderPointer,
            highlightedItems,
            highlightColor,
            currentSelection: undefined,
            anythingMoving: moveMgr.areDrawablesMoving(),
        }
        const currentSelection = this.eventMgr.currentSelection
        drawParams.currentSelection = currentSelection
        const drawComp = (comp: Component) => {
            g.beginGroup(comp.constructor.name)
            try {
                comp.draw(g, drawParams)
                for (const node of comp.allNodes()) {
                    node.draw(g, drawParams) // never show nodes as selected
                }
            } finally {
                g.endGroup()
            }
        }

        const root = this._editorRoot

        // draw background components
        g.beginGroup("background")
        for (const comp of root.components.withZIndex(DrawZIndex.Background)) {
            drawComp(comp)
        }
        g.endGroup()

        // draw wires
        g.beginGroup("wires")
        root.linkMgr.draw(g, drawParams) // never show wires as selected
        g.endGroup()

        // draw normal components
        g.beginGroup("components")
        for (const comp of root.components.withZIndex(DrawZIndex.Normal)) {
            drawComp(comp)
        }
        g.endGroup()

        // draw anchor of moving component, if any
        const movingCompWithAnchor = moveMgr.getSingleMovingComponentWithAnchors()
        if (movingCompWithAnchor !== undefined) {
            g.beginGroup("anchors")
            drawAnchorsForComponent(g, movingCompWithAnchor, true)
            g.endGroup()
        } else if (this._options.showAnchors) {
            g.beginGroup("anchors")
            for (const comp of root.components.all()) {
                drawAnchorsForComponent(g, comp, false)
            }
            g.endGroup()
        }

        // draw overlays
        g.beginGroup("overlays")
        for (const comp of root.components.withZIndex(DrawZIndex.Overlay)) {
            drawComp(comp)
        }
        g.endGroup()

        // draw refs
        if (this._options.showIDs) {
            g.beginGroup("refs")
            g.font = 'bold 14px sans-serif'
            g.strokeStyle = "white"
            g.lineWidth = 3
            g.fillStyle = COLOR_COMPONENT_ID
            g.textAlign = 'center'
            for (const comp of root.components.all()) {
                if (comp.ref !== undefined) {
                    strokeTextVAlign(g, TextVAlign.middle, comp.ref, comp.posX, comp.posY)
                    fillTextVAlign(g, TextVAlign.middle, comp.ref, comp.posX, comp.posY)
                }
            }
            g.endGroup()
        }

        // draw selection
        let selRect
        if (currentSelection !== undefined && (selRect = currentSelection.currentlyDrawnRect) !== undefined) {
            g.beginGroup("selection")
            g.lineWidth = 1.5
            g.strokeStyle = "rgb(100,100,255)"
            g.fillStyle = "rgba(100,100,255,0.2)"
            g.beginPath()
            g.rect(selRect.x, selRect.y, selRect.width, selRect.height)
            g.stroke()
            g.fill()
            g.endGroup()
        }

        // this.drawDebugInfo(g)
    }

    private drawDebugInfo(g: GraphicsRendering) {
        // debug draw origin
        drawPoint(0, 0)
        for (const d of [100, 200]) {
            for (const [x, y] of [[-d, -d], [-d, 0], [-d, d], [0, -d], [0, d], [d, d], [d, 0], [d, -d]]) {
                drawPoint(x, y)
            }
        }

        function drawPoint(x: number, y: number) {
            g.lineWidth = 2
            g.strokeStyle = "red"
            g.beginPath()
            g.moveTo(x - 10, y)
            g.lineTo(x + 10, y)
            g.moveTo(x, y - 10)
            g.lineTo(x, y + 10)
            g.stroke()
            g.fillStyle = "black"
            g.font = 'bold 10px sans-serif'
            g.textAlign = 'left'
            fillTextVAlign(g, TextVAlign.top, `${x},${y}`, x + 4, y + 4)
        }
    }

    public deleteSelection() {
        if (this.eventMgr.currentSelectionEmpty()) {
            return false
        }
        let anyDeleted = false
        for (const elem of this.eventMgr.currentSelection?.previouslySelectedElements ?? []) {
            anyDeleted = this.eventMgr.tryDeleteDrawable(elem).isChange || anyDeleted
        }

        if (!anyDeleted) {
            return false
        }

        this.editTools.undoMgr.takeSnapshot()
        return true
    }

    public async cut() {
        const copied = await this.copy()
        if (!copied) {
            return
        }
        await this.deleteSelection()
    }

    public async copy(): Promise<boolean> {
        if (this.eventMgr.currentSelectionEmpty()) {
            return false
        }
        const componentsToInclude: Component[] = []
        for (const elem of this.eventMgr.currentSelection?.previouslySelectedElements ?? []) {
            if (elem instanceof ComponentBase) {
                componentsToInclude.push(elem)
            }
        }

        // TODO check if we're copying custom components to include their def?
        // ... but then, beware of duplicated custom components if pasting into the same circuit,
        // or find some compatibility criterion for component defs (e.g., number of in/out nodes
        // and names) that would seem enough to determine they are the same (beyond their id/name)
        const reprs = Serialization.buildComponentsAndWireObject(componentsToInclude, [], [this.pointerX, this.pointerY])
        if (reprs.components === undefined && reprs.wires === undefined) {
            return false
        }

        const jsonStr = Serialization.stringifyObject(reprs, false)
        const copied = await copyToClipboard(jsonStr)
        if (copied) {
            console.log("Copied:\n" + jsonStr)
        } else {
            console.log("Could not copy")
        }
        this.focus()
        return copied
    }

    public async paste() {
        const oldDontHogFocus = this._dontHogFocus
        this._dontHogFocus = true
        let jsonStr: string | undefined = undefined
        try {
            jsonStr = await pasteFromClipboard()
        } finally {
            this._dontHogFocus = oldDontHogFocus
        }
        if (jsonStr === undefined || jsonStr === "") {
            return
        }
        const errorOrComps = Serialization.pasteComponents(this, jsonStr)
        if (isString(errorOrComps)) {
            console.log(errorOrComps)
        } else {
            const selection = new EditorSelection(undefined)
            for (const comp of errorOrComps) {
                selection.toggle(comp)
            }
            this.eventMgr.currentSelection = selection
        }
        this.focus()
    }

    public wrapHandler<T extends unknown[], R>(f: (...params: T) => R extends Promise<any> ? never : R): (...params: T) => R {
        return (...params: T) => {
            const result = f(...params)
            this.recalcPropagateAndDrawIfNeeded()
            return result
        }
    }

    public wrapAsyncHandler<T extends unknown[], R>(f: (...params: T) => Promise<R>): (...params: T) => Promise<R> {
        return async (...params: T) => {
            const result = await f(...params)
            this.recalcPropagateAndDrawIfNeeded()
            return result
        }
    }

    public static decodeFromURLOld(str: string) {
        return decodeURIComponent(atob(str.replace(/-/g, "+").replace(/_/g, "/").replace(/%3D/g, "=")))
    }

    public static getGraphics(canvas: HTMLCanvasElement): GraphicsRendering {
        const g = canvas.getContext("2d")! as GraphicsRendering
        g.createPath = (path?: Path2D | string) => new Path2D(path)
        g.beginGroup = () => undefined
        g.endGroup = () => undefined
        return g
    }
}

export class LogicStatic {

    public constructor(
        public readonly template: HTMLTemplateElement,
    ) { }

    public singleton: LogicEditor | undefined

    public highlight(diagramRefs: string | string[], componentRefs: string | string[]) {
        if (isString(diagramRefs)) {
            diagramRefs = [diagramRefs]
        }
        for (const diagramRef of diagramRefs) {
            const diagram = document.getElementById("logic_" + diagramRef) ?? document.getElementById(diagramRef)
            if (diagram === null) {
                console.log(`Cannot find logic diagram with reference '${diagramRef}'`)
                return
            }
            if (!(diagram instanceof LogicEditor)) {
                console.log(`Element with id '${diagramRef}' is not a logic editor`)
                return
            }
            diagram.highlight(componentRefs)
        }
    }

    public runSampleTestSuite(options: unknown): void {
        const f = async () => {
            if (this.singleton) {
                const testSuite = new TestSuite([{
                    name: "Simple XOR gate test suite",
                    cases: [{
                        name: "false false -> false",
                        in: { in0: 0, in1: 0 },
                        out: { out0: 0 },
                        stopOnFail: true,
                    }, {
                        name: "false true -> true",
                        in: { in0: 1, in1: 0 },
                        out: { out0: 1 },
                    }, {
                        name: "true false -> true",
                        in: { in0: 0, in1: 1 },
                        out: { out0: 1 },
                    }, {
                        name: "true true -> false",
                        in: { in0: 1, in1: 1 },
                        out: { out0: 0 },
                    }],
                }, this.singleton.editorRoot.components])
                const _opts = isRecord(options) ? options : {}
                const results = await this.singleton.runTestSuite(testSuite, _opts)
                if (results === undefined) {
                    console.error("Could not run test suite")
                } else {
                    results.dump()
                }
            }
        }
        setTimeout(f, 0)
    }

    public printUndoStack() {
        this.singleton?.editTools.undoMgr.dump()
    }

    public readonly tests = new Tests()

    public readonly Serialization = Serialization

    public setDarkMode(mode: boolean | string) {
        if (mode === "auto") {
            mode = window.matchMedia("(prefers-color-scheme: dark)").matches
        } else if (mode === "false") {
            mode = false
        } else if (isString(mode)) {
            const col = parseColorToRGBA(mode)
            if (col !== undefined) {
                const rgbaString = col[3] === 255 ? `rgb(${col[0]}, ${col[1]}, ${col[2]})` : `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${col[3] / 255})`
                USER_COLORS.COLOR_BACKGROUND = rgbaString
                const looksDark = col[0] + col[1] + col[2] < 3 * 128
                console.log(`Will use '${rgbaString}' as background color, interpreted as a ${looksDark ? "dark" : "light"} theme`)
                mode = looksDark
            }
        }
        setDarkMode(Boolean(mode), true)
    }

}


if (InBrowser) {
    // cannot be in setup function because the 'template' var is not assigned until that func returns
    // and promotion of elems occurs during this 'customElements.define' call
    const template = (() => {
        const template = document.createElement('template')
        template.innerHTML = LogicEditorTemplate
        const styles = [LogicEditorCSS, DialogPolyfillCSS]
        template.content.querySelector("#inlineStyle")!.innerHTML = styles.join("\n\n\n")
        template.content.querySelectorAll("i.svgicon").forEach(setupSvgIcon)
        return template
    })()
    window.Logic = new LogicStatic(template)
    window.customElements.define('logic-editor', LogicEditor)
    document.addEventListener("toggle", e => {
        if (!(e.target instanceof HTMLDetailsElement)) {
            return
        }
        if (e.target.open) {
            e.target.querySelectorAll("logic-editor").forEach(el => {
                if (el instanceof LogicEditor) {
                    el.redraw()
                }
            })
        }
    }, true)

} else {
    // TODO
    console.log("cli")
}
