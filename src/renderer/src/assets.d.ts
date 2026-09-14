declare module '*.css'

declare module '*.ttf?url' {
  const src: string
  export default src
}

declare module '*.otf?url' {
  const src: string
  export default src
}
