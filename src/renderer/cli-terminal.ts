import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

export class CLITerminal {
  private terminal: Terminal;
  private fitAddon: FitAddon;
  private container: HTMLElement;
  private onInputCallback?: (data: string) => void;

  constructor(container: HTMLElement) {
    this.container = container;

    // Initialize terminal
    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: "#0a0a0a",
        foreground: "#f8f8f2",
        cursor: "#00d9ff",
        black: "#000000",
        red: "#ff5555",
        green: "#50fa7b",
        yellow: "#f1fa8c",
        blue: "#bd93f9",
        magenta: "#ff79c6",
        cyan: "#00d9ff",
        white: "#f8f8f2",
        brightBlack: "#6272a4",
        brightRed: "#ff6e6e",
        brightGreen: "#69ff94",
        brightYellow: "#ffffa5",
        brightBlue: "#d6acff",
        brightMagenta: "#ff92df",
        brightCyan: "#a4ffff",
        brightWhite: "#ffffff",
      },
      rows: 20,
      cols: 80,
    });

    // Add fit addon
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Open terminal in container
    this.terminal.open(container);
    this.fitAddon.fit();

    // Handle terminal input
    this.terminal.onData((data) => {
      if (this.onInputCallback) {
        this.onInputCallback(data);
      }
    });

    // Handle resize
    window.addEventListener("resize", () => {
      this.fitAddon.fit();
    });
  }

  write(data: string): void {
    this.terminal.write(data);
  }

  writeln(data: string): void {
    this.terminal.writeln(data);
  }

  clear(): void {
    this.terminal.clear();
  }

  onInput(callback: (data: string) => void): void {
    this.onInputCallback = callback;
  }

  resize(): void {
    this.fitAddon.fit();
  }

  focus(): void {
    this.terminal.focus();
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
