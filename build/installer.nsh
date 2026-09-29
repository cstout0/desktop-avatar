# Desktop Avatar always installs just for the current user (no admin rights needed; its settings
# and downloads live in the user's own folders), so skip the "Who should this application be
# installed for?" page, whose all-users option would only be greyed out.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
