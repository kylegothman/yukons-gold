import './view/style.css';
import { Hud } from './view/hud';
import { Session } from './view/session';
import { View3D } from './view/View3D';

const seedFromUrl = Number(new URLSearchParams(location.search).get('seed'));
const sizeFromUrl = Number(new URLSearchParams(location.search).get('size'));
const ses = new Session(seedFromUrl || Math.floor(Math.random() * 1e6) + 1, [64, 128, 256].includes(sizeFromUrl) ? sizeFromUrl : undefined);
const view = new View3D(ses, document.getElementById('game')!);
const hud = new Hud(ses);
(window as any).__game = { ses, view, hud }; // handy in the console while tuning
