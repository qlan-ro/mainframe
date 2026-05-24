---
'@qlan-ro/mainframe-desktop': patch
---

Fix the executable-path browse dialog in Settings showing "Select Project Directory". `DirectoryPickerModal` now accepts a `title` prop and defaults to "Select File" in file mode; the provider executable picker passes "Select &lt;Provider&gt; Executable".
