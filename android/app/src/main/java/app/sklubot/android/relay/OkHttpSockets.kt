package app.sklubot.android.relay

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.util.concurrent.TimeUnit

/**
 * RelaySocket over OkHttp's WebSocket (https://square.github.io/okhttp/4.x/okhttp/okhttp3/-web-socket/).
 * pingInterval: OkHttp sends a ping every 25 s and fails the socket when the pong does not come back (protocol §9).
 * No Origin header is sent: the server refuses device connections that carry one (relay.ts).
 */
class OkHttpSockets(userAgent: String) : SocketFactory {
    private val ua = userAgent
    private val client = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(false)
        .build()

    override fun open(url: String, listener: SocketListener): RelaySocket {
        val request = Request.Builder().url(url).header("User-Agent", ua).build()
        val ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = listener.onOpen()
            override fun onMessage(webSocket: WebSocket, text: String) = listener.onText(text)
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) = listener.onBinary()
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, null) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = listener.onClosed(code, reason)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
                listener.onFailure(response?.let { "HTTP ${it.code}" } ?: (t.message ?: t.javaClass.simpleName))
        })
        return object : RelaySocket {
            override fun send(text: String) = ws.send(text)
            override fun close(code: Int, reason: String) { ws.close(code, reason.take(120)) }
            override fun cancel() = ws.cancel()
        }
    }
}
