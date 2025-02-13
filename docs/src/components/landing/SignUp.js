import * as React from 'react';
import PropTypes from 'prop-types';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import FormHelperText from '@mui/material/FormHelperText';
import InputBase, { inputBaseClasses } from '@mui/material/InputBase';
import KeyboardArrowRightRounded from '@mui/icons-material/KeyboardArrowRightRounded';
import { styled } from '@mui/material/styles';
import ROUTES from '../../route';

const Form = styled('form')({});

function SignUp({ sx }) {
  const [form, setForm] = React.useState({
    email: '',
    status: 'initial',
  });
  const handleSubmit = async (event) => {
    event.preventDefault();
    setForm((current) => ({ ...current, status: 'loading' }));
    try {
      await fetch(ROUTES.TOOLPAD_SIGN_UP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        mode: 'no-cors',
        body: new URLSearchParams({
          EMAIL: form.email,
          email_address_check: '',
          locale: 'en',
        }),
      });
      setForm((current) => ({ ...current, status: 'sent' }));
      window.ga('send', {
        hitType: 'event',
        eventCategory: 'ToolpadLanding',
        eventAction: 'SignUp',
        eventLabel: 'Sign Up',
      });
    } catch (error) {
      setForm((current) => ({ ...current, status: 'failure' }));
    }
  };
  if (form.status === 'sent') {
    return (
      <Alert
        severity="success"
        sx={[
          {
            maxWidth: { sm: 540 },
            mx: { xs: 0, sm: 'auto' },
            bgcolor: 'success.50',
          },
          (theme) =>
            theme.applyDarkStyles({
              bgcolor: 'primaryDark.700',
            }),
        ]}
        iconMapping={{
          success: (
            <CheckCircleRoundedIcon
              fontSize="small"
              sx={[
                {
                  color: 'success.700',
                },
                (theme) => theme.applyDarkStyles({ color: 'success.600' }),
              ]}
            />
          ),
        }}
      >
        <AlertTitle sx={{ typography: 'body2', fontWeight: 700 }}>
          Thanks! Check your email.
        </AlertTitle>
        You should get a <strong>confirmation email</strong> soon. Open it up and confirm your email
        address so that we can keep you up to date.
      </Alert>
    );
  }
  return (
    <Form onSubmit={handleSubmit} sx={sx}>
      <Box
        sx={{
          display: 'flex',
          gap: 0,
          width: { xs: '100%', sm: 'auto' },
          maxWidth: 320,
        }}
      >
        <InputBase
          id="email-landing"
          name="email"
          type="email"
          aria-label="Email"
          placeholder="example@email.com"
          inputProps={{ required: true }}
          value={form.email}
          onChange={(event) => setForm({ email: event.target.value, status: 'initial' })}
          sx={[
            {
              mr: { xs: 0, sm: 1 },
              mb: { xs: 1, sm: 0 },
              minWidth: { xs: 220, sm: 360 },
              width: { xs: '100%', sm: 'auto' },
              bgcolor: '#fff',
              boxShadow: '0 1px 2px 0 rgba(0 0 0 / 0.08)',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'grey.300',
              px: 1,
              py: 0.5,
              // height: 48,
              typography: 'body2',
              '&:hover': {
                borderColor: 'grey.400',
                boxShadow: '0 1px 2px 0 rgba(0 0 0 / 0.2)',
              },
              [`&.${inputBaseClasses.focused}`]: {
                borderColor: (theme) => theme.palette.primary[500],
                outline: '3px solid',
                outlineColor: (theme) => theme.palette.primary[100],
              },
            },
            (theme) =>
              theme.applyDarkStyles({
                bgcolor: theme.palette.primaryDark[900],
                boxShadow: '0 1px 2px 0 rgba(0 0 0 / 1)',
                borderColor: theme.palette.primaryDark[500],
                '&:hover': {
                  borderColor: theme.palette.primaryDark[300],
                  boxShadow: '0 1px 2px 0 rgba(0 0 0 / 1)',
                },
                [`&.${inputBaseClasses.focused}`]: {
                  borderColor: theme.palette.primary[300],
                  outlineColor: theme.palette.primary[500],
                },
              }),
          ]}
        />
        <Button
          disabled={form.status === 'loading'}
          type="submit"
          size="medium"
          variant="contained"
          endIcon={<KeyboardArrowRightRounded />}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          Sign up
        </Button>
      </Box>
      {form.status === 'failure' ? (
        <FormHelperText
          sx={[
            { color: 'warning.700' },
            (theme) => theme.applyDarkStyles({ color: 'warning.500' }),
          ]}
        >
          Oops! something went wrong, please try again later.
        </FormHelperText>
      ) : null}
    </Form>
  );
}

SignUp.propTypes = {
  sx: PropTypes.object,
};

export default SignUp;
