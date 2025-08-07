import * as dotenv from 'dotenv';
dotenv.config();

import { handler } from './handler';

const event = {
  body: JSON.stringify({
    name: 'Pippo',
    surname: 'Pluto',
    email: 'pippo@pluto.com',
    message: 'Happy wedding! I wish you the best!',
  }),
} as any;

console.log(event);

handler(event, {} as any, (err, result) => {
  if (err) console.error(err);
  else console.log(result);
});
