#!/bin/bash

# Telegraf Manager - Unified Installation Script

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Script Configuration & Globals ---
PYTHON_VERSION="3.12.11"
VENV_NAME=".venv"
DB_FILE="database/telegraf_manager.db"
MIGRATIONS_DIR="migrations"
OFFLINE_DIR="offline_files"

# Flags for verbosity and logging
VERBOSE=false
LOG_FILE=""
MAIN_COMMAND=""

# --- Helper Functions for Colored Output ---
print_info() {
    echo -e "\033[36m[INFO]\033[0m $1"
}

print_success() {
    echo -e "\033[32m[SUCCESS]\033[0m $1"
}

print_error() {
    echo -e "\033[31m[ERROR]\033[0m $1"
}

print_warning() {
    echo -e "\033[33m[WARNING]\033[0m $1"
}

# --- Help Message ---
show_help() {
    cat << EOF
Telegraf Manager - Unified Installation Script

Usage: $0 [options] [command]

Options:
  -v, --verbose       Enable verbose output, showing all executed commands.
  -l, --log           Log all output to a file (e.g., install-YYYY-MM-DD-HHMMSS.log).
  -h, --help          Show this help message.

Commands:
  --full-install      Run the full installation process from offline assets.
  --install-deps      Install only the project dependencies into the virtual environment.
  --init-db           Initialize or re-initialize the application database.
  --create-package    Create a complete offline deployment package.
  --download-assets   Download all assets required for an offline installation.

Example:
  ./install.sh -v -l --full-install

EOF
}

# --- Core Functions ---

download_assets() {
    print_info "Downloading all offline assets..."
    # ... (implementation remains the same)
}

check_prerequisites() {
    print_info "Checking system prerequisites..."
    # ... (implementation remains the same)
}

install_pyenv_and_python() {
    if [ "$VERBOSE" = true ]; then set -x; fi

    print_info "Starting pyenv and Python installation..."
    export PYENV_ROOT="$HOME/.pyenv"
    
    if [ ! -d "$PYENV_ROOT" ]; then
        if [ ! -f "$OFFLINE_DIR/python/pyenv.tar.gz" ]; then
            print_error "pyenv.tar.gz not found..."
            if [ "$VERBOSE" = true ]; then set +x; fi; exit 1
        fi
        print_info "Installing pyenv..."
        tar -xzf "$OFFLINE_DIR/python/pyenv.tar.gz"
        PYENV_EXTRACTED_DIR=$(tar -tzf "$OFFLINE_DIR/python/pyenv.tar.gz" | head -1 | cut -f1 -d"/")
        mv "$PYENV_EXTRACTED_DIR" "$PYENV_ROOT"
        
        print_info "Updating .bashrc to include pyenv configuration..."
        if ! grep -q "# pyenv configuration" ~/.bashrc; then
            cat <<'EOF' >> ~/.bashrc

# pyenv configuration
export PYENV_ROOT="$HOME/.pyenv"
command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"
EOF
            print_success "Pyenv configuration added to .bashrc."
        else
            print_info "Pyenv configuration already exists in .bashrc."
        fi
    else
        print_info "Pyenv is already installed."
    fi

    export PATH="$PYENV_ROOT/bin:$PATH"
    eval "$(pyenv init -)"

    if ! pyenv versions | grep -q "$PYTHON_VERSION"; then
        print_info "Installing Python $PYTHON_VERSION..."
        local python_archive="$OFFLINE_DIR/python/Python-$PYTHON_VERSION.tar.xz"
        if [ ! -f "$python_archive" ]; then
            print_error "Python source archive not found: $python_archive"
            if [ "$VERBOSE" = true ]; then set +x; fi; exit 1
        fi
        
        print_info "Placing Python source into pyenv cache..."
        mkdir -p "$PYENV_ROOT/cache"
        cp "$python_archive" "$PYENV_ROOT/cache/"
        
        if [ "$VERBOSE" = true ]; then
            print_info "Verifying file in cache..."
            ls -l "$PYENV_ROOT/cache/"
            print_info "Running pyenv install with verbose output..."
            pyenv install -v "$PYTHON_VERSION"
        else
            pyenv install "$PYTHON_VERSION"
        fi
        print_success "Python $PYTHON_VERSION installed."
    else
        print_info "Python $PYTHON_VERSION is already installed."
    fi
    
    pyenv global "$PYTHON_VERSION"
    print_success "Set Python $PYTHON_VERSION as the global default."

    if [ "$VERBOSE" = true ]; then set +x; fi
}

install_dependencies() {
    print_info "Installing project dependencies..."
    # ... (implementation remains the same)
}

init_database() {
    print_info "Initializing the database..."
    # ... (implementation remains the same)
}

create_offline_package() {
    set -x # Enable debugging for this function

    print_info "Creating complete offline deployment package..."
    
    local deploy_dir="telegraf_manager_offline"
    local archive_name="telegraf_manager_offline.tar.gz"

    # Cleanup old versions
    rm -rf "$deploy_dir" "$archive_name"

    print_info "Creating deployment directory: $deploy_dir"
    mkdir -p "$deploy_dir"

    print_info "Copying project files with exclusions..."

    # Use rsync to copy files, which makes excluding patterns easy
    rsync -av --progress ./* "$deploy_dir/" \
        --exclude "database" \
        --exclude "log" \
        --exclude ".venv" \
        --exclude ".git" \
        --exclude ".vscode" \
        --exclude ".env*" \
        --exclude "*.pyc" \
        --exclude "__pycache__" \
        --exclude "$deploy_dir" \
        --exclude "$archive_name"

    # rsync with --exclude might not create the excluded top-level directory,
    # so we create empty ones in the package for a clean structure.
    mkdir -p "$deploy_dir/database"
    mkdir -p "$deploy_dir/log"

    print_info "Creating final tarball: $archive_name"
    tar -czf "$archive_name" "$deploy_dir"

    # Final cleanup
    rm -rf "$deploy_dir"

    print_success "Offline deployment package created: $archive_name"
    print_info "Size: $(du -h $archive_name | cut -f1)"

    set +x # Disable debugging for this function
}

# --- Argument Parsing and Main Logic ---
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--verbose)
                VERBOSE=true
                shift # past argument
                ;;
            -l|--log)
                LOG_FILE="install-$(date +%F-%H%M%S).log"
                shift # past argument
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            --*) 
                if [ -n "$MAIN_COMMAND" ]; then
                    print_error "Only one main command is allowed."
                    exit 1
                fi
                MAIN_COMMAND="$1"
                shift # past argument
                ;;
            *)
                print_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    if [ -z "$MAIN_COMMAND" ]; then
        print_error "No command provided."
        show_help
        exit 1
    fi
}

main() {
    parse_args "$@"

    # Set up logging if enabled
    if [ -n "$LOG_FILE" ]; then
        print_info "Logging all output to: $LOG_FILE"
        # Redirect stdout and stderr to a log file and the console
        exec &> >(tee -a "$LOG_FILE")
    fi

    case "$MAIN_COMMAND" in
        --full-install)
            check_prerequisites
            install_pyenv_and_python
            install_dependencies
            init_database
            print_success "--- Full installation complete! ---"
            if ! command -v pyenv &>/dev/null; then
                print_warning "Pyenv is installed but not yet active in your current terminal."
                print_info "To activate it, please run: exec \$SHELL"
            else
                print_info "To start, run: ./start.sh"
            fi
            ;;
        --install-deps)
            install_dependencies
            ;;
        --init-db)
            init_database
            ;;
        --create-package)
            create_offline_package
            ;;
        --download-assets)
            download_assets
            ;;
        *)
            print_error "Invalid command: $MAIN_COMMAND"
            show_help
            exit 1
            ;;
    esac
}

# Run the main function with all provided arguments
main "$@"
