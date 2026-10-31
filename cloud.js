/*
 * Jas Studio online saving (Firebase project jas-studio).
 *
 * Instructors sign in with an email and password. Their edits (events, prices,
 * instructors, community posts) are saved to Firestore so every visitor sees
 * them. Each list is one document in `site/{key}`; photos inside a list are
 * moved into their own `photos/{id}` documents, because a Firestore document
 * holds at most 1 MB. Who may save is decided by the Firestore rules, which
 * check the signed-in email against the `config/admins` document.
 */
(function () {
  var CONFIG = {
    apiKey: 'AIzaSyAgYfxAph-yp6Qm7z7W6EqpqdkAIbsAUVw',
    authDomain: 'jas-studio.firebaseapp.com',
    projectId: 'jas-studio',
    storageBucket: 'jas-studio.firebasestorage.app',
    messagingSenderId: '581972372866',
    appId: '1:581972372866:web:f2f4c915f92bdf3c78739b'
  };
  var PHOTO_REF = 'photo:';

  if (!window.firebase) { console.warn('Firebase did not load; the site shows its built-in content.'); return; }
  firebase.initializeApp(CONFIG);
  var auth = firebase.auth(), db = firebase.firestore();
  // An instructor stays signed in until the tab closes, like the old login.
  auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(function () {});

  function hash(s) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return x.toString(16).padStart(2, '0'); }).join('').slice(0, 40);
    });
  }

  // Walks a saved list, swapping every embedded photo for a reference (save) or back (load).
  function walk(v, fn) {
    if (typeof v === 'string') return fn(v);
    if (Array.isArray(v)) return Promise.all(v.map(function (x) { return walk(x, fn); }));
    if (v && typeof v === 'object') {
      var keys = Object.keys(v);
      return Promise.all(keys.map(function (k) { return walk(v[k], fn); })).then(function (vals) {
        var o = {}; keys.forEach(function (k, i) { o[k] = vals[i]; }); return o;
      });
    }
    return Promise.resolve(v);
  }

  var known = {}; // photo ids already in Firestore, so they are not written twice
  function stashPhoto(s) {
    if (!/^data:image\//.test(s)) return Promise.resolve(s);
    return hash(s).then(function (id) {
      if (known[id]) return PHOTO_REF + id;
      return db.collection('photos').doc(id).set({ d: s }).then(function () { known[id] = true; return PHOTO_REF + id; });
    });
  }
  var photoCache = {};
  function fetchPhoto(s) {
    if (typeof s !== 'string' || s.indexOf(PHOTO_REF) !== 0) return Promise.resolve(s);
    var id = s.slice(PHOTO_REF.length);
    if (!photoCache[id]) photoCache[id] = db.collection('photos').doc(id).get().then(function (d) { known[id] = true; return d.exists ? d.data().d : ''; }, function () { return ''; });
    return photoCache[id];
  }

  var timers = {}, pending = {};
  function writeNow(key) {
    var list = pending[key]; delete pending[key];
    return walk(list, stashPhoto).then(function (clean) {
      return db.collection('site').doc(key).set({ json: JSON.stringify(clean), updated: firebase.firestore.FieldValue.serverTimestamp(), by: (auth.currentUser || {}).email || '' });
    }).catch(function (e) {
      console.error('Save failed', key, e);
      alert(e && e.code === 'permission-denied' ? 'This account is not allowed to save changes.' : 'Your change could not be saved online. Check the connection and try again.');
    });
  }

  window.jasCloud = {
    signIn: function (email, pass) { return auth.signInWithEmailAndPassword(email, pass); },
    signOut: function () { return auth.signOut(); },
    onUser: function (cb) { return auth.onAuthStateChanged(cb); },
    // Resolves to { key: list } for every list saved online.
    load: function (keys) {
      return Promise.all(keys.map(function (key) {
        return db.collection('site').doc(key).get().then(function (d) {
          if (!d.exists) return null;
          return walk(JSON.parse(d.data().json), fetchPhoto).then(function (v) { return [key, v]; });
        }, function (e) { console.warn('Load failed', key, e); return null; });
      })).then(function (pairs) { var o = {}; pairs.forEach(function (p) { if (p) o[p[0]] = p[1]; }); return o; });
    },
    // Typing fires a save per keystroke, so writes wait for a short pause.
    save: function (key, list) {
      pending[key] = list; clearTimeout(timers[key]);
      timers[key] = setTimeout(function () { writeNow(key); }, 800);
    }
  };
  // A save still waiting when the tab closes is sent straight away.
  window.addEventListener('pagehide', function () { Object.keys(pending).forEach(function (k) { clearTimeout(timers[k]); writeNow(k); }); });
})();
