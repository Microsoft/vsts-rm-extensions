# Terraform tool installer


### Overview

The Terraform Tool Installer task acquires a specified version of [Terraform](https://www.terraform.io/) from the Internet or the tools cache and prepends it to the PATH of the Azure Pipelines Agent (hosted or private). Use this task to change the version of Terraform used in subsequent tasks like [Terraform](https://aka.ms/AA5jd98).
Adding this task before the [Teraform task](https://aka.ms/AA5jd98) in a build definition ensures you are using that task with the right Terraform version.


### Contact Information

Please report a problem at [Developer Community Forum](https://developercommunity.visualstudio.com/spaces/21/index.html) if you are facing problems in making this task work. You can also share feedback about the task like, what more functionality should be added to the task, what other tasks you would like to have, at the same place.


### Pre-requisites for the task

The task can run on the following build agent operating systems:
- Windows
- MacOS
- Linux

** Terraform is already installed on hosted Ubuntu build agents (currently version 0.11.13). So, this task may not be used for these agents unless a different version of Terraform is needed.

### Parameters of the task

* **Display name\*:** Provide a name to identify the task among others in your pipeline.

* **Version\*:** Specify the exact version of Teraform to install.
Example: 
    To install Terraform version 0.11.4, use 0.11.4
For getting more details about exact version, refer [this link](https://releases.hashicorp.com/terraform/)


### Output Variables

* **Terraform location:** This variable can be used to refer to the location of the terraform binary that was installed on the agent in subsequent tasks.
