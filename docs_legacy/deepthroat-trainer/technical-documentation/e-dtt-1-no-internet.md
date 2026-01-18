---
description: "Message: No Internet. Check Firewall and Router"
---

# E-DTT-1: No Internet

### What This Means

Your device successfully connected to your Wi-Fi network, but it could not reach the remote server.\
This usually means your router or firewall is blocking the device from accessing the internet.

---

### Common Causes

- Your router’s firewall is set too strict.
- The device is blocked in your router’s “Access Control” or “Security” settings.
- Certain network filters (like “child protection,” “IoT isolation,” or “private network only”) are preventing communication.

---

### Step-by-Step Fix

#### 1. Log in to Your Router Settings

Most routers can be accessed by entering `192.168.0.1` or `192.168.1.1` in your browser.\
If unsure, check the label on your router for login details or search online for your router model.

---

#### 2. Check for Blocked Devices

Look for menus like:

- **Access Control**
- **MAC Filtering**
- **Device List**

Make sure your **Trainer** device is **not blocked**. If blocked, remove it from the blocked list.

---

#### 3. Adjust Firewall Settings

If your router allows firewall levels (e.g., High / Medium / Low):

- Change from **High** to **Medium** or **Low**.
- Save your changes.

---

#### 4. Reboot Everything

- Restart your **router**.
- Restart your **Trainer** device.

Then wait a few minutes and check if the error clears.

---

#### 5. Try the Hotspot Method (if still not working)

If the problem persists, your router may be filtering IoT traffic.\
You can confirm this using your phone’s hotspot.

**Steps:**

1. Turn on your phone’s hotspot:
   - Android Hotspot Guide
   - [iPhone Hotspot Guide](https://support.apple.com/en-us/HT204023)
2. On your **Trainer**, open the Wi-Fi setup page.
3. Using a **laptop or second device**, connect to the **“Trainer Setup”** Wi-Fi network.
4. Follow the setup steps and connect the Trainer to your phone’s hotspot.
5. Once connected, the error should disappear—confirming your router was blocking it.

---

#### 6. (Optional) Adjust Router Rules Permanently

Once confirmed, you can:

- Create an **allow rule** for the Trainer’s MAC address in your router.
- Keep your firewall at **Medium** or **Low** for trusted IoT devices.

---

#### Summary

**Error E-DTT-1** means your device is online but can’t reach the internet.\
Follow these steps to allow it through your router’s firewall, or test with a mobile hotspot to confirm.

Once traffic is allowed, the Trainer will automatically reconnect and the error will clear.
