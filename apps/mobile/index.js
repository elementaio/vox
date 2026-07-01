// Polyfills FIRST — before the SDK loads. RN lacks crypto.getRandomValues; this
// installs it (the SDK's only host requirement now that it uses pure-JS crypto).
import "react-native-get-random-values";

import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
