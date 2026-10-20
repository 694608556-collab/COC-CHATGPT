module.exports = async function (port) {
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
  if (targets.length !== 1) throw Error('Expected one isolated WebView')
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl),
    pending = new Map()
  let serial = 0
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const item = pending.get(message.id)
      if (item) {
        pending.delete(message.id)
        message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result)
      }
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++serial
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  return {
    send,
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails)
        throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
      return result.result.value
    },
    close() {
      socket.close()
    }
  }
}
