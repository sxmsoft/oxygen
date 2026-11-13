import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import './lib/ui.css';
import './cc/cc.css';
import { createEnvironment } from './lib/env';

void createEnvironment().then((env) => {
  mount(App, {
    target: document.getElementById('app')!,
    props: { env },
  });
});
