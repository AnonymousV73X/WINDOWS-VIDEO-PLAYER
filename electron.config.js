/**
 * NovaPlay — Electron Builder Configuration
 * Mirrors NovaTune's build setup. Targets Windows x64 NSIS installer.
 *
 * For VLC runtime: NovaPlay auto-discovers libvlc.dll from common VLC install
 * paths (%ProgramFiles%\VideoLAN\VLC\libvlc.dll) at startup. No bundled VLC.
 */

const path = require('path');

module.exports = {
  appId: 'com.novaplay.player',
  productName: 'NovaPlay',
  copyright: '© 2024 NovaPlay. All rights reserved.',

  directories: {
    output: path.join(__dirname, 'dist'),
    buildResources: path.join(__dirname, 'assets')
  },

  // Don't rebuild native modules in-place — we use prebuilt binaries.
  npmRebuild: false,

  files: [
    'app-shell/**/*',
    'video-engine/**/*',
    'ui/**/*',
    'local-data/**/*',
    'assets/**/*',
    'package.json'
  ],

  // Video file associations — register NovaPlay as default for all common formats.
  fileAssociations: [
    { ext: 'mp4',  name: 'NovaPlay.MP4',  description: 'MP4 Video',     mimeType: 'video/mp4' },
    { ext: 'mkv',  name: 'NovaPlay.MKV',  description: 'Matroska Video', mimeType: 'video/x-matroska' },
    { ext: 'avi',  name: 'NovaPlay.AVI',  description: 'AVI Video',     mimeType: 'video/x-msvideo' },
    { ext: 'mov',  name: 'NovaPlay.MOV',  description: 'QuickTime Video', mimeType: 'video/quicktime' },
    { ext: 'webm', name: 'NovaPlay.WEBM', description: 'WebM Video',    mimeType: 'video/webm' },
    { ext: 'flv',  name: 'NovaPlay.FLV',  description: 'Flash Video',   mimeType: 'video/x-flv' },
    { ext: 'wmv',  name: 'NovaPlay.WMV',  description: 'Windows Media',  mimeType: 'video/x-ms-wmv' },
    { ext: 'm4v',  name: 'NovaPlay.M4V',  description: 'M4V Video',      mimeType: 'video/x-m4v' },
    { ext: 'mpg',  name: 'NovaPlay.MPG',  description: 'MPEG Video',     mimeType: 'video/mpeg' },
    { ext: 'mpeg', name: 'NovaPlay.MPEG', description: 'MPEG Video',     mimeType: 'video/mpeg' },
    { ext: 'ts',  name: 'NovaPlay.TS',   description: 'Transport Stream', mimeType: 'video/mp2t' },
    { ext: 'm2ts', name: 'NovaPlay.M2TS', description: 'M2TS Video',     mimeType: 'video/mp2t' },
    { ext: 'vob',  name: 'NovaPlay.VOB',  description: 'DVD VOB',        mimeType: 'video/dvd' },
    { ext: 'ogv',  name: 'NovaPlay.OGV',  description: 'Ogg Video',      mimeType: 'video/ogg' },
    { ext: '3gp',  name: 'NovaPlay.3GP',  description: '3GP Video',      mimeType: 'video/3gpp' }
  ],

  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ],
    icon: path.join(__dirname, 'assets', 'icons', 'icon.ico'),
    requestedExecutionLevel: 'asInvoker'
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: path.join(__dirname, 'assets', 'icons', 'icon.ico'),
    uninstallerIcon: path.join(__dirname, 'assets', 'icons', 'icon.ico'),
    installerHeaderIcon: path.join(__dirname, 'assets', 'icons', 'icon.ico'),
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'NovaPlay',
    perMachine: false,
    differentialPackage: true
  }
};
