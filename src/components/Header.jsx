import { Typography, Box, useTheme } from "@mui/material";
import { tokens } from "../theme";

const Header = ({ title, subtitle }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  return (
    <Box mb="30px">
      <Typography
        variant="h2"
        color={colors.primary[800]}
        fontWeight="bold"
        sx={{ m: "-108px 0 5px 0" }}
      >
        {title}
      </Typography>
      <Typography variant="h5" color={colors.tealAccent[400]}>
        {subtitle}
      </Typography>
    </Box>
  );
};

export default Header;
