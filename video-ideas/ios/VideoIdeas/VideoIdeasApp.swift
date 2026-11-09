import SwiftUI
import WebKit

// The list is a normal webpage (video-ideas-delta.vercel.app) with its own storage, so there is no sign-in.
// Secrets.swift (not in git) holds the private link; copy Secrets.swift.example to make it.
private let appURL = URL(string: Secrets.listURL)!
// Same page without the key part (the page already saved the key), so "Try again" is a real reload.
private let retryURL = Secrets.listURL.components(separatedBy: "#").first ?? Secrets.listURL

@main
struct VideoIdeasApp: App {
    var body: some Scene {
        WindowGroup {
            WebScreen()
                .ignoresSafeArea(.container, edges: .bottom)
                .background(Color(red: 0.06, green: 0.05, blue: 0.14))
        }
    }
}

struct WebScreen: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()          // keeps the private key and a copy of the list
        config.allowsInlineMediaPlayback = true
        let web = WKWebView(frame: .zero, configuration: config)
        web.allowsBackForwardNavigationGestures = true
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.06, green: 0.05, blue: 0.14, alpha: 1)
        context.coordinator.web = web
        web.load(URLRequest(url: appURL))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        weak var web: WKWebView?

        // Links that open a new window load in the same screen instead of being dropped.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
            return nil
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showOffline(webView, error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showOffline(webView, error) }

        private func showOffline(_ webView: WKWebView, _ error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            let html = """
            <html><head><meta name=viewport content="width=device-width,initial-scale=1"></head>
            <body style="background:#100e24;color:#eeecfb;font:18px -apple-system;display:grid;place-items:center;height:90vh;text-align:center;padding:24px">
            <div><h2>Can't reach your list</h2><p>Check your internet, then tap below.</p><p><a href="\(retryURL)" style="display:inline-block;background:#9d87ff;color:#120f2b;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:600">Try again</a></p></div></body></html>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }
    }
}
