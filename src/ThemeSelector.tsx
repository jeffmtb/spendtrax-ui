import { FormControl, InputLabel, MenuItem, Select } from "@mui/material";
import { useAppearance } from "./AppearanceProvider";

export default function ThemeSelector() {
  const { preference, setPreference } = useAppearance();

  return (
    <FormControl size="small" sx={{ minWidth: 120 }}>
      <InputLabel id="theme-label">Theme</InputLabel>
      <Select
        labelId="theme-label"
        id="theme-select"
        label="Theme"
        value={preference}
        onChange={(event) => {
          const next = event.target.value;
          if (next === "light" || next === "dark" || next === "system") {
            setPreference(next);
          }
        }}
      >
        <MenuItem value="system">System</MenuItem>
        <MenuItem value="light">Light</MenuItem>
        <MenuItem value="dark">Dark</MenuItem>
      </Select>
    </FormControl>
  );
}
