import { registerRootComponent } from "expo";

// Defines the background check task at startup (expo-task-manager needs it in the global scope).
import "./src/notify";
import App from "./App";

registerRootComponent(App);
