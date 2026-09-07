export class BridgeAdapter {
  available() {
    return false;
  }

  request() {
    return Promise.reject(new Error("BridgeAdapter is not available in Phase 1"));
  }
}

export class NoOpBridgeAdapter extends BridgeAdapter {
  available() {
    return false;
  }
}
