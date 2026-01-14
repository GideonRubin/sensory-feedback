# Sensory Feedback App

## Project Setup

### Prerequisites
- Node.js (v18 or higher recommended)
- npm (comes with Node.js)

### Installation

1. Navigate to the project directory:
   ```bash
   cd v1/WebApp/sensory-feedback
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Development Server

To start the development server with Hot Module Replacement (HMR):

```bash
npm run dev
```

Open your browser and navigate to the URL shown in the terminal (usually `http://localhost:5173`).

### Running with Mock Data (Stubs)

To run the application with simulated sensor data (useful for development without the physical device):

```bash
npm test
```
This command runs the development server with `VITE_USE_STUBS=true` enabled.

### Building for Production

To build the application for production:

```bash
npm run build
```

The build artifacts will be stored in the `dist/` directory.

### Previewing the Production Build

To preview the production build locally:

```bash
npm run preview
```

## Architecture

![Architecture](./architecture.jpg)

### Overview
The system architecture ties together the Web Application, the ESP32 Hardware, and Cloud Storage.

### Components & Communication

**1. Web Application (PWA)**
- Acts as the central **Client**.
- Communicates with the hardware via the **Browser Bluetooth API**.
- Communicates with the cloud via **HTTP**.

**2. ESP32 (Hardware)**
- Acts as a **BLE Server**.
- Collects raw **Sensor Data**.
- **BLE Communication Loop**:
  - **Reads (from App perspective)**: Sensor data, Battery health.
  - **Writes (from App perspective)**: Volume settings, Sensor thresholds, "Ping" test commands.

**3. Vercel Cloud (Blob Storage)**
- Used for persistent storage of session data.
- **Writes**: Saves sensor recordings (JSON).
- **Reads**: Retrieves past sensor recordings (JSON).

