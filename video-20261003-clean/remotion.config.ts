import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setPixelFormat('yuv420p')
Config.setConcurrency(4)
Config.setChromiumOpenGlRenderer('angle')
