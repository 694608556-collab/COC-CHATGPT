declare module '*.css'

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.ttf?url' {
  const src: string
  export default src
}

declare module '*.otf?url' {
  const src: string
  export default src
}
