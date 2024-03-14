# Setup Prerequisites

To set up the prerequisites for a development environment that includes Node.js, package managers, and PostgreSQL, follow these instructions for different operating systems.

## macOS

Start with installing homebrew from the [official website](https://brew.sh/).

```sh
brew update
brew install bun
brew install postgresql
brew install --cask pgadmin4
brew services start postgresql
bun i --global @jerrythomas/dbd
```

## For Linux (Ubuntu/Debian based distributions):

```sh
sudo apt update
sudo apt install snapd
sudo snap install bun
sudo apt-get install postgresql -y
systemctl start postgresql systemctl enable postgresql
systemctl status postgresql

bun i --global @jerrythomas/dbd
```

## For Windows using WSL2:

## Setting up WSL2

Before installing Linux distributions on Windows, you must enable the "Windows Subsystem for Linux" optional feature and install WSL2. Microsoft's guide on installing WSL2 can be found [here](https://docs.microsoft.com/en-us/windows/wsl/install).

After setting up WSL2 with your preferred Linux distribution (e.g., Ubuntu), use the Linux instructions from above within the WSL2 terminal.

## Setup WSL2 with systemd

Inside your Ubuntu instance, add the following modification to /etc/wsl.conf.

```
[boot]
systemd=true
```

Then restart your instance by running wsl --shutdown in PowerShell and relaunching Ubuntu.

## Install dependencies

```sh
sudo apt update
sudo apt install snapd
sudo apt install postgresql-client
sudo snap install bun
bun i --global @jerrythomas/dbd
```
