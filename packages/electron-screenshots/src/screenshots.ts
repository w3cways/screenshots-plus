import debug, { Debugger } from 'debug'
import {
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  app,
  CreateFromBufferOptions
} from 'electron'
import Events from 'events'
import fs from 'fs-extra'
import Event from './event'
import getDisplay, { Display } from './getDisplay'
import padStart from './padStart'
import { Bounds, ScreenshotsData } from './preload'

export type LoggerFn = (...args: unknown[]) => void;
export type Logger = Debugger | LoggerFn;
const isMac = process.platform === 'darwin'
export interface Lang {
  magnifier_position_label?: string;
  operation_ok_title?: string;
  operation_cancel_title?: string;
  operation_save_title?: string;
  operation_redo_title?: string;
  operation_undo_title?: string;
  operation_mosaic_title?: string;
  operation_text_title?: string;
  operation_brush_title?: string;
  operation_arrow_title?: string;
  operation_ellipse_title?: string;
  operation_rectangle_title?: string;
}

export interface ScreenshotsOpts {
  lang?: Lang;
  logger?: Logger;
  singleWindow?: boolean;
}

const webPreferences = {
  preload: require.resolve('./preload.js'),
  nodeIntegration: false,
  contextIsolation: true,
  nativeWindowOpen: false
}

export { Bounds }

export default class Screenshots extends Events {
  // 截图窗口对象
  public $win: BrowserWindow | null = null

  // public $view: BrowserView = new BrowserView({
  //   webPreferences: {
  //     preload: require.resolve('./preload.js'),
  //     nodeIntegration: false,
  //     contextIsolation: true,
  //     nativeWindowOpen: false
  //   }
  // })

  private startTime: any
  private imageUrl = ''

  private singleWindow: boolean

  private isReady = new Promise<void>((resolve) => {
    ipcMain.once('SCREENSHOTS:ready', () => {
      resolve()
    })
  })

  constructor (opts?: ScreenshotsOpts) {
    super()
    this.singleWindow = opts?.singleWindow || false
    this.listenIpc()
    // this.$view.webContents.loadURL(
    //   `file://${require.resolve('react-screenshots/electron/electron.html')}`
    // )
    this.$win = this.createWin()
    if (opts?.lang) {
      this.setLang(opts.lang)
    }
  }

  /**
   * 开始截图
   */
  public async startCapture (): Promise<void> {
    if (this.imageUrl || !this.$win) {
      // 已经在截图界面了，不再唤起截图，参考企业微信
      return
    }
    const display = getDisplay()

    const [imageUrl] = await Promise.all([this.capture(display), this.isReady])
    this.imageUrl = imageUrl
    this.setWinSize(display)

    this.$win.webContents.send('SCREENSHOTS:capture', display, imageUrl)
  }

  /**
   * 结束截图
   */
  public async endCapture (): Promise<void> {
    this.reset()

    if (!this.$win) {
      return
    }
    this.$win.setResizable(true)
    this.$win.setAlwaysOnTop(false)

    // this.$win.hide()

    if (isMac) {
      // mac下需要先hide，加快关闭截图速度，
      this.$win.hide()
      this.$win.webContents.reloadIgnoringCache()
    }
    this.$win.webContents.send('SCREENSHOTS:reset')

    this.$win.setBounds({ width: 0, height: 0 })

    this.$win.blur()
    this.$win.setResizable(false)

    // 先清除 Kiosk 模式，然后取消全屏才有效
    // this.$win.setAlwaysOnTop(false)
    // // this.$win.setKiosk(false)
    // // this.$win.setFullScreen(false)
    // // this.$win.setSimpleFullScreen(false)
    // this.$win.blur()
    // // this.$win.blurWebView()
    // // this.$win.unmaximize()
    // // this.$win.removeBrowserView(this.$view)

    // if (this.singleWindow) {
    //   this.$win.setSize(0, 0)
    //   if (isMac) {
    //     this.$view.webContents.send('SCREENSHOTS:reset')
    //   } else {
    //     this.$view.webContents.reloadIgnoringCache()
    //   }
    //   //
    //   // this.$win.hide()
    // } else {
    //   this.$win.close()
    //   this.$win = null
    // }
  }

  /**
   * 设置语言
   */
  public async setLang (lang: Partial<Lang>): Promise<void> {
    if (!this.$win) {
      return
    }
    await this.isReady

    this.$win.webContents.send('SCREENSHOTS:setLang', lang)
  }

  private async reset () {
    this.imageUrl = ''

    // // 重置截图区域
    // this.$view.webContents.send('SCREENSHOTS:reset')

    // // 保证 UI 有足够的时间渲染
    // await Promise.race([
    //   new Promise<void>(resolve => setTimeout(() => resolve(), 500)),
    //   new Promise<void>(resolve => ipcMain.once('SCREENSHOTS:reset', () => resolve()))
    // ])
  }

  /**
   * @description 初始化窗口 只执行一次
   */
  private createWin () {
    const win = new BrowserWindow({
      title: 'screenshots',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      useContentSize: true,
      frame: false,
      show: true,
      autoHideMenuBar: true,
      transparent: true,
      // resizable 设置为 false 会导致页面崩溃
      // resizable: false,
      movable: false,
      // focusable: true, 否则窗口不能及时响应esc按键，输入框也不能输入
      focusable: true,
      // linux 下必须设置为false，否则不能全屏显示在最上层
      // mac 下设置为true，鼠标移动到屏幕上方菜单栏处，才不会唤出菜单栏
      fullscreen: false,
      // 设为true 防止mac新开一个桌面，影响效果
      simpleFullscreen: false,
      backgroundColor: '#00000000',
      titleBarStyle: 'hidden',
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      skipTaskbar: true,
      hasShadow: false,
      paintWhenInitiallyHidden: false,
      acceptFirstMouse: true,
      resizable: false, // 禁止拖拽，不然截图唤起后，鼠标移动到边缘会显示缩放，会有问题
      thickFrame: false,
      webPreferences
    })
    win.loadURL(
      `file://${require.resolve('react-screenshots/electron/electron.html')}`
    )

    win.on('enter-full-screen', () => {
      if (isMac) {
        app.dock.show() // mac全屏后需要显示程序坞
      }
    })

    return win
  }

  /**
   * @description 设置窗口大小
   * @param {Display} display
   * @returns
   */
  private setWinSize (display: Display) {
    if (!this.$win) {
      return
    }
    this.$win.setResizable(true)
    this.$win.setKiosk(false)
    // this.$win.setFullScreen(isMac)
    // this.$win.setSimpleFullScreen(isMac)
    const { width, scaleFactor, height } = display // 截图的时候按照DPI截图，这里要按照DPI还原成原始大小
    display.width = width / scaleFactor
    display.height = height / scaleFactor
    this.$win.setBounds(display, false)
    // this.$view.setBounds({
    //   x: 0,
    //   y: 0,
    //   width: display.width,
    //   height: display.height
    // })

    this.$win.setAlwaysOnTop(true, 'screen-saver')
    this.$win.setVisibleOnAllWorkspaces(true)
    this.$win.setResizable(false) // 调整完大小后要禁用
    this.$win.show() // 需要show一下，保证再其他窗口上面
    // this.$win.show() // 需要show一下，保证再其他窗口上面
  }

  private async capture (display: Display): Promise<string> {
    try {
      const { Screenshots: NodeScreenshots } = await import('node-screenshots')
      const capturer = NodeScreenshots.fromDisplay(display.id)
      if (!capturer) {
        throw new Error(`NodeScreenshots.fromDisplay(${display.id}) get null`)
      }

      const image = await capturer.capture()
      return `data:image/png;base64,${image.toString('base64')}`
    } catch (err) {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: display.width,
          height: display.height
        }
      })

      let source
      // Linux系统上，screen.getDisplayNearestPoint 返回的 Display 对象的 id
      // 和这里 source 对象上的 display_id(Linux上，这个值是空字符串) 或 id 的中间部分，都不一致
      // 但是，如果只有一个显示器的话，其实不用判断，直接返回就行
      if (sources.length === 1) {
        source = sources[0]
      } else {
        source = sources.find((source) => {
          return (
            source.display_id === display.id.toString() ||
            source.id.startsWith(`screen:${display.id}:`)
          )
        })
      }

      if (!source) {
        throw new Error("Can't find screen source")
      }

      return source.thumbnail.toDataURL()
    }
  }

  /**
   * 绑定ipc时间处理
   */
  private listenIpc (): void {
    /**
     * OK事件
     */
    ipcMain.on('SCREENSHOTS:ok', (e, buffer: Buffer, data: ScreenshotsData) => {
      const event = new Event()
      this.emit('ok', event, buffer, data)
      if (event.defaultPrevented) {
        return
      }
      // console.log('ok', event, buffer, data)

      const { bounds, display } = data
      const { width, height } = bounds

      const options: CreateFromBufferOptions = {
        width,
        height
      }
      const originalImage = nativeImage.createFromBuffer(buffer, options)
      const image = originalImage.resize({
        width,
        height
      })
      clipboard.writeImage(image)
      this.endCapture()
    })
    /**
     * CANCEL事件
     */
    ipcMain.on('SCREENSHOTS:cancel', () => {
      const event = new Event()
      this.emit('cancel', event)
      if (event.defaultPrevented) {
        return
      }
      this.endCapture()
    })

    /**
     * SAVE事件
     */
    ipcMain.on(
      'SCREENSHOTS:save',
      async (e, buffer: Buffer, data: ScreenshotsData) => {
        const event = new Event()
        this.emit('save', event, buffer, data)
        if (event.defaultPrevented || !this.$win) {
          return
        }

        const time = new Date()
        const year = time.getFullYear()
        const month = padStart(time.getMonth() + 1, 2, '0')
        const date = padStart(time.getDate(), 2, '0')
        const hours = padStart(time.getHours(), 2, '0')
        const minutes = padStart(time.getMinutes(), 2, '0')
        const seconds = padStart(time.getSeconds(), 2, '0')
        const milliseconds = padStart(time.getMilliseconds(), 3, '0')

        // this.$win.setAlwaysOnTop(false)

        const { canceled, filePath } = await dialog.showSaveDialog(this.$win, {
          defaultPath: `${year}${month}${date}${hours}${minutes}${seconds}${milliseconds}.png`
        })

        if (!this.$win) {
          return
        }
        // this.$win.setAlwaysOnTop(true)
        if (canceled || !filePath) {
          return
        }

        await fs.writeFile(filePath, buffer)
        this.endCapture()
      }
    )
  }
}
