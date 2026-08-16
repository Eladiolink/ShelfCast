'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBrowseResult, parseDuration } = require('../src/dlna/contentdirectory.js');

const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
 <s:Body><u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
  <Result>&lt;?xml version="1.0" encoding="UTF-8"?&gt;
&lt;DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"&gt;
&lt;item id="m1" parentID="movies" restricted="1"&gt;&lt;dc:title&gt;The.Matrix.1999.1080p.mkv&lt;/dc:title&gt;&lt;upnp:class&gt;object.item.videoItem&lt;/upnp:class&gt;&lt;res protocolInfo="http-get:*:video/x-matroska:*" size="12345" duration="1:30:00" resolution="1920x1080"&gt;http://192.168.1.50/video.mkv&lt;/res&gt;&lt;/item&gt;
&lt;container id="movies" parentID="0" restricted="1" childCount="2"&gt;&lt;dc:title&gt;Movies&lt;/dc:title&gt;&lt;upnp:class&gt;object.container.storageFolder&lt;/upnp:class&gt;&lt;/container&gt;
&lt;/DIDL-Lite&gt;</Result>
  <NumberReturned>2</NumberReturned>
  <TotalMatches>2</TotalMatches>
 </u:BrowseResponse></s:Body></s:Envelope>`;

test('parseia Result com item e container', () => {
  const r = parseBrowseResult(SAMPLE, 'http://192.168.1.50');
  assert.equal(r.total, 2);
  assert.equal(r.returned, 2);
  assert.equal(r.items.length, 1);
  assert.equal(r.containers.length, 1);

  const item = r.items[0];
  assert.equal(item.title, 'The.Matrix.1999.1080p.mkv');
  assert.equal(item.url, 'http://192.168.1.50/video.mkv');
  assert.equal(item.duration, 5400);
  assert.equal(item.mime, 'video/x-matroska');
  assert.equal(item.width, 1920);
  assert.equal(item.height, 1080);
  assert.equal(item.size, 12345);
  assert.equal(item.objectId, 'm1');

  const cont = r.containers[0];
  assert.equal(cont.title, 'Movies');
  assert.equal(cont.objectId, 'movies');
  assert.equal(cont.childCount, 2);
});

test('parseia duração em formatos variados', () => {
  assert.equal(parseDuration('1:30:00'), 5400);
  assert.equal(parseDuration('00:02:30'), 150);
  assert.equal(parseDuration('02:30'), 150);
  assert.equal(parseDuration('02:30.500'), 150);
  assert.equal(parseDuration('inválido'), null);
});
