import { WebSocket } from 'ws';
const ws = new WebSocket('ws://localhost:18800');

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'req', id: '1', method: 'connect', params: { client: { id: 'test', version: '1', platform: 'node' } }
  }));
});

ws.on('message', (data) => {
  console.log('RECV:', data.toString());
  const msg = JSON.parse(data.toString());
  if (msg.type === 'res' && msg.id === '1') {
    ws.send(JSON.stringify({
      type: 'req', id: '2', method: 'chat.send', params: { sessionKey: 'test-sess', message: 'Hello' }
    }));
  }
});

ws.on('close', () => console.log('Closed'));
ws.on('error', (err) => console.error('Error:', err));
