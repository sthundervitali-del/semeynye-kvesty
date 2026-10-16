/* Сервис-воркер: push-уведомления Firebase и установка приложения на телефон. */
importScripts("/__/firebase/10.14.1/firebase-app-compat.js", "/__/firebase/10.14.1/firebase-messaging-compat.js", "/__/firebase/init.js");

const messaging = firebase.messaging();
// Сообщения с блоком notification показываются автоматически, когда приложение закрыто.
messaging.onBackgroundMessage(() => {});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // нужен для установки как приложение

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.FCM_MSG && e.notification.data.FCM_MSG.notification && e.notification.data.FCM_MSG.notification.click_action) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
