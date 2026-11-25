# Connect a fermentation device

Use `POST /api/integrations/devices` with a signed-in session and the batch ID. Personal batch
owners and brewery owners or brewers can connect a device. Keep the returned upload URL private.
The URL accepts device requests without a Brew-Bruvs session.

- **iSpindel** — Select HTTP POST and paste the upload URL. Use a calibration formula that reports degrees Plato.
- **GravityMon** — Use an HTTP JSON push with the iSpindel-compatible format and the upload URL. Include the gravity unit. When the firmware includes corrected gravity, Brew-Bruvs stores that value.
- **Tilt Pi** — Set the cloud logging URL to the upload URL. The native Tilt form reports SG and Fahrenheit.
- **TiltBridge** — Use the custom logging target. Set `tiltColor` if the bridge broadcasts other colors to the same target.
- **RAPT Pill** — Configure a POST custom webhook in the RAPT portal. Use this payload for specific gravity and Celsius. For a source emitting SG × 1000, use `"sg1000"` as the gravity unit.

  ```text
  {"gravity": @gravity, "temperature": @temperature, "gravity_unit": "SG", "temp_unit": "C"}
  ```

Use HTTPS when the device supports it. A device that supports HTTP only should post over a trusted
local network. Redact the upload query string in any reverse proxy access logs. Brew-Bruvs
timestamps readings on receipt and converts incoming units to SG and Celsius. It accepts up to
12 requests per token per minute, with a payload limit of 16 KiB.

`GET /api/integrations/devices` lists metadata and the time of the last accepted reading. To replace
the URL, call `POST /api/integrations/devices/{id}/rotate` and update the device. To revoke the
integration, call `DELETE /api/integrations/devices/{id}`. A deleted batch or a transfer to a
different owner disables uploads to its old integration.

Firmware formats: [iSpindel](https://github.com/universam1/iSpindel),
[GravityMon](https://mp-se.github.io/gravitymon/v1.4/data.html),
[Tilt Pi](https://github.com/baronbrew/TILTpi#tilt-cloud-logging-api),
[TiltBridge](https://github.com/thorrak/tiltbridge/blob/master/src/sendData.cpp),
[RAPT Portal](https://docs.rapt.io/).
