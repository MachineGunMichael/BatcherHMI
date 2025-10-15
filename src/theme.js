// theme.js
import { createContext, useMemo, useState } from "react";
import { createTheme } from "@mui/material/styles";

// Define core palette that stays mostly the same between light/dark

const teal = {
    100: "#cedfe1",
    200: "#9ebec2",
    300: "#6d9ea4",
    400: "#3d7d85",
    500: "#0c5d67",
    600: "#0a4a52",
    700: "#07383e",
    800: "#052529",
    900: "#021315"
};

// const grey = {
//     100: "#e4e4e4",
//     200: "#cacaca",
//     300: "#afafaf",
//     400: "#959595",
//     500: "#7a7a7a",
//     600: "#626262",
//     700: "#494949",
//     800: "#313131",
//     900: "#181818"
// };

const red = {
    100: "#f1d6d5",
    200: "#e2adab",
    300: "#d48582",
    400: "#c55c58",
    500: "#b7332e",
    600: "#922925",
    700: "#6e1f1c",
    800: "#491412",
    900: "#250a09"
};

const orange = {
    100: "#fadbd2",
    200: "#f5b8a5",
    300: "#f09479",
    400: "#eb714c",
    500: "#e64d1f",
    600: "#b83e19",
    700: "#8a2e13",
    800: "#5c1f0c",
    900: "#2e0f06"
};

const purple = {
    100: "#e3d3dd",
    200: "#c7a7bb",
    300: "#aa7a98",
    400: "#8e4e76",
    500: "#722254",
    600: "#5b1b43",
    700: "#441432",
    800: "#2e0e22",
    900: "#170711"
};

const beige = {
    100: "#b6ab82",
    200: "#c6bd99",
    300: "#d6cfb0",
    400: "#e6e1c7",
    500: "#f6f3de",
    600: "#f9f6e5",
    700: "#fcf9ec",
    800: "#fefbf2",
    900: "#fffdf8",
};

// const yellow = {
//   100: "#fffbd1",
//   200: "#fff89e",
//   300: "#fff37a",
//   400: "#f0e57c",
//   500: "#e2d866",
//   600: "#bfb34c",
//   700: "#938c2e",
//   800: "#676314",
//   900: "#4a4710",
// };

// const purple = {
//   100: "#f3f3fd",
//   200: "#e0e0f9",
//   300: "#bbbae4",
//   400: "#9d9ecf",
//   500: "#7e81bb",
//   600: "#62679b",
//   700: "#464b73",
//   800: "#2f314d",
//   900: "#1d1f2f",
// };

export const tokens = (mode) => ({
  ...(mode === "light"
    ? {
        primary: {
          100: "#ffffff",
          200: "#dcdcdc",
          300: "#bcbcbc",
          400: "#9d9d9d",
          500: "#7d7d7d",
          600: "#5e5e5e",
          700: "#454545",
          800: "#2d2d2d",
          900: "#1a1a1a",
          1000: "#0b0b0b",
        },
        grey: {
          100: "#f6f6f6",
          200: "#e0e0e0",
          300: "#c2c2c2",
          400: "#a3a3a3",
          500: "#858585",
          600: "#5f5f5f",
          700: "#3b3b3b",
          800: "#222222",
          900: "#141414",
        },

        beige: {
          100: "#fffdf8",
          200: "#fefbf2",
          300: "#fcf9ec",
          400: "#f9f6e5",
          500: "#f6f3de",
          600: "#e6e1c7",
          700: "#d6cfb0",
          800: "#c6bd99",
          900: "#b6ab82",
        },
        beigeAccent: beige,
        tealAccent: teal,
        redAccent: red,
        orangeAccent: orange,
        purpleAccent: purple,
      }
    : {
        primary: {
          0: "#0b0b0b",
          100: "#1a1a1a",
          200: "#2d2d2d",
          300: "#454545",
          400: "#5e5e5e",
          500: "#7d7d7d",
          600: "#9d9d9d",
          700: "#bcbcbc",
          800: "#dcdcdc",
          900: "#ffffff",
        },
        grey: {
          100: "#141414",
          200: "#222222",
          300: "#3b3b3b",
          400: "#5f5f5f",
          500: "#858585",
          600: "#a3a3a3",
          700: "#c2c2c2",
          800: "#e0e0e0",
          900: "#f6f6f6",
        },
        beige: {
          100: "#b6ab82",
          200: "#c6bd99",
          300: "#d6cfb0",
          400: "#e6e1c7",
          500: "#f6f3de",
          600: "#f9f6e5",
          700: "#fcf9ec",
          800: "#fefbf2",
          900: "#fffdf8",
        },
        beigeAccent: beige,
        tealAccent: teal,
        redAccent: red,
        orangeAccent: orange,
        purpleAccent: purple,
      }),
});

export const themeSettings = (mode) => {
  const colors = tokens(mode);
  return {
    palette: {
      mode: mode,
      ...(mode === "dark"
        ? {
            // palette values for dark mode
            primary: {
              main: colors.primary[500],
            },
            secondary: {
              main: colors.tealAccent[500],
            },
            neutral: {
              dark: colors.orangeAccent[700],
              main: colors.orangeAccent[500],
              light: colors.orangeAccent[100],
            },
            background: {
              default: colors.primary[100],
            },
          }
        : {
            // palette values for light mode
            primary: {
              main: colors.primary[100],
            },
            secondary: {
              main: colors.tealAccent[500],
            },
            neutral: {
              dark: colors.orangeAccent[700],
              main: colors.orangeAccent[500],
              light: colors.orangeAccent[100],
            },
            background: {
              default: colors.primary[100],
            },
          }),
    },
    typography: {
      fontFamily: ["Quarion", "sans-serif"].join(","),
      fontSize: 12,
      h1: { fontFamily: "Quarion, sans-serif", fontSize: 40 },
      h2: { fontFamily: "Quarion, sans-serif", fontSize: 32 },
      h3: { fontFamily: "Quarion, sans-serif", fontSize: 24 },
      h4: { fontFamily: "Quarion, sans-serif", fontSize: 20 },
      h5: { fontFamily: "Quarion, sans-serif", fontSize: 16 },
      h6: { fontFamily: "Quarion, sans-serif", fontSize: 14 },
      h7: { fontFamily: "Quarion, sans-serif", fontSize: 12 },
      h8: { fontFamily: "Quarion, sans-serif", fontSize: 8 },
    },
  };
};

export const ColorModeContext = createContext({ toggleColorMode: () => {} });

export const useMode = () => {
  const [mode, setMode] = useState("light");

  const colorMode = useMemo(
    () => ({
      toggleColorMode: () =>
        setMode((prev) => (prev === "light" ? "dark" : "light")),
    }),
    []
  );

  const theme = useMemo(() => createTheme(themeSettings(mode)), [mode]);
  return [theme, colorMode];
};