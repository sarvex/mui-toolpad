import * as React from 'react';
import {
  // Card,
  // CardActionArea,
  // CardContent,
  Chip,
  Unstable_Grid2 as Grid,
  Typography,
  Drawer,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
} from '@mui/material';
import InboxIcon from '@mui/icons-material/MoveToInbox';
import MailIcon from '@mui/icons-material/Mail';
import { Link, Outlet, useLocation } from 'react-router-dom';
import * as appDom from '../appDom';
import { VersionOrPreview } from '../types';

// interface PageCardProps {
//   page: appDom.PageNode;
// }

// function PageCard({ page }: PageCardProps) {
//   return (
//     <Card sx={{ gridColumn: 'span 1' }}>
//       <CardActionArea component={Link} to={`/pages/${page.id}`}>
//         <CardContent>
//           <Typography gutterBottom variant="h5">
//             {page.name}
//           </Typography>
//           <Typography variant="body2" color="text.secondary">
//             {page.attributes.title.value}
//           </Typography>
//         </CardContent>
//       </CardActionArea>
//     </Card>
//   );
// }

interface AppOverviewProps {
  dom: appDom.AppDom;
  version: VersionOrPreview;
}

export default function AppOverview({ dom, version }: AppOverviewProps) {
  const location = useLocation();
  const isEditor = React.useMemo(() => !window.location.pathname.match(/preview|deploy/g), []);
  const app = dom ? appDom.getApp(dom) : null;
  const { pages = [] } = dom && app ? appDom.getChildNodes(dom, app) : {};
  return (
    <Grid container>
      {isEditor ? null : (
        <Grid xs={2}>
          <Drawer
            variant="permanent"
            sx={{
              width: {
                xs: 0,
                md: 240,
              },
              flexShrink: 0,
              [`& .MuiDrawer-paper`]: { width: 240, boxSizing: 'border-box' },
            }}
          >
            <div style={{ display: 'flex' }}>
              <Typography variant="h4" sx={{ m: 2 }}>
                Pages
              </Typography>
              {version === 'preview' ? (
                <Chip label="Preview" color="primary" sx={{ mt: 3.5 }} size="small" />
              ) : null}
            </div>
            <Divider />
            <List>
              {pages.map((page, index) => (
                <ListItem key={page.id} disablePadding>
                  <ListItemButton
                    component={Link}
                    to={`/pages/${page.id}`}
                    selected={location.pathname.includes(page.id)}
                  >
                    <ListItemIcon>{index % 2 === 0 ? <InboxIcon /> : <MailIcon />}</ListItemIcon>
                    <ListItemText primary={page.name} />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Drawer>
        </Grid>
      )}
      <Grid xs={isEditor ? 12 : 10}>
        <Outlet />
      </Grid>
    </Grid>
  );
}
